import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentSkills,
  agentTaskQueue,
  agents,
  autopilotRuns,
  autopilots,
  comments,
  issues,
  members,
  runtimes,
  skills,
  taskMessages,
  userConnections,
  users,
  workspaces,
} from "../db/schema/index";
import { generateMachineToken } from "../lib/machine-token";
import { _resetKeyCache, encryptToken } from "../lib/token-crypto";
import daemonRouter from "./daemon";

describe("daemon routes — auth shape", () => {
  it("requires bearer machine token on register", async () => {
    const res = await daemonRouter.request("/api/daemon/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", daemonVersion: "0", detectedClis: [] }),
    });
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /api/daemon/tasks/:taskId/messages — batch upload of agent execution
// messages. Verified end-to-end (with a real runtime row + machine token):
//   - cross-runtime token leak → 404
//   - happy path inserts rows + returns highest seq
//   - retry safe via onConflictDoNothing on (task_id, seq)
//   - missing `messages` array → 400
// =============================================================================

describe("POST /api/daemon/tasks/:taskId/messages", () => {
  let workspaceId: string;
  let userId: string;
  let agentId: string;
  let runtimeId: string;
  let otherRuntimeId: string;
  let taskId: string;
  let machineToken: string;
  let otherMachineToken: string;

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const [u] = await db
      .insert(users)
      .values({ email: `dmsg-${stamp}@x`, name: "DM" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    userId = u!.id;
    const [w] = await db
      .insert(workspaces)
      .values({ name: "DM", slug: `dm-${stamp}`, issuePrefix: "DM" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    workspaceId = w!.id;
    const [m] = await db.insert(members).values({ workspaceId, userId, role: "owner" }).returning();
    const tok = generateMachineToken();
    machineToken = tok.token;
    const [r] = await db
      .insert(runtimes)
      .values({
        workspaceId,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        memberId: m!.id,
        name: `rt-${stamp}`,
        machineTokenHash: tok.hash,
        daemonVersion: "0.0.1",
        online: true,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    runtimeId = r!.id;
    // A second runtime in the same workspace so we can prove token isolation:
    // its machine token must not be able to write messages onto runtimeId's task.
    const otherTok = generateMachineToken();
    otherMachineToken = otherTok.token;
    const [r2] = await db
      .insert(runtimes)
      .values({
        workspaceId,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        memberId: m!.id,
        name: `rt-other-${stamp}`,
        machineTokenHash: otherTok.hash,
        daemonVersion: "0.0.1",
        online: true,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    otherRuntimeId = r2!.id;
    const [a] = await db
      .insert(agents)
      .values({
        workspaceId,
        name: "dm-agent",
        runtimeId,
        cliKind: "claude_code",
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    agentId = a!.id;
    const [task] = await db
      .insert(agentTaskQueue)
      .values({
        workspaceId,
        agentId,
        runtimeId,
        status: "running",
        startedAt: new Date(),
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    taskId = task!.id;
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
  });

  function postMessages(token: string, body: unknown) {
    return daemonRouter.request(`/api/daemon/tasks/${taskId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  }

  it("404 when machine token belongs to a different runtime than the task", async () => {
    const res = await postMessages(otherMachineToken, {
      messages: [{ seq: 1, kind: "stdout", content: { text: "hi" } }],
    });
    expect(res.status).toBe(404);
  });

  it("inserts 3 messages and returns { ok: true, latestSeq: 3 }", async () => {
    const res = await postMessages(machineToken, {
      messages: [
        { seq: 1, kind: "stdout", content: { text: "a" } },
        { seq: 2, kind: "assistant", content: { text: "b" } },
        { seq: 3, kind: "tool_use", content: { name: "Bash", input: {} } },
      ],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; latestSeq: number };
    expect(json.ok).toBe(true);
    expect(json.latestSeq).toBe(3);

    const rows = await db
      .select()
      .from(taskMessages)
      .where(sql`task_id = ${taskId}`)
      .orderBy(taskMessages.seq);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("idempotent: re-POSTing seq=1 doesn't duplicate the row", async () => {
    const first = await postMessages(machineToken, {
      messages: [{ seq: 1, kind: "stdout", content: { text: "once" } }],
    });
    expect(first.status).toBe(200);

    const second = await postMessages(machineToken, {
      messages: [{ seq: 1, kind: "stdout", content: { text: "again" } }],
    });
    expect(second.status).toBe(200);

    const rows = await db.select().from(taskMessages).where(sql`task_id = ${taskId} AND seq = 1`);
    expect(rows.length).toBe(1);
    // onConflictDoNothing — first write wins.
    expect((rows[0]?.content as { text: string }).text).toBe("once");
  });

  it("latestSeq reflects persisted MAX(seq), not the resubmitted batch max", async () => {
    // Push seqs 1..5 — stream advances to 5.
    const initial = await postMessages(machineToken, {
      messages: [1, 2, 3, 4, 5].map((seq) => ({
        seq,
        kind: "stdout" as const,
        content: { text: `m${seq}` },
      })),
    });
    expect(initial.status).toBe(200);
    const initialJson = (await initial.json()) as { latestSeq: number };
    expect(initialJson.latestSeq).toBe(5);

    // Now replay an OLD batch — the daemon retry path can hand us a stale
    // window. onConflictDoNothing dedupes, so the stream MUST still report
    // 5, not the batch's own max (2). Returning batch-max here would have
    // the web client rewind ?since= and re-render stale rows.
    const replay = await postMessages(machineToken, {
      messages: [
        { seq: 1, kind: "stdout", content: { text: "replay1" } },
        { seq: 2, kind: "stdout", content: { text: "replay2" } },
      ],
    });
    expect(replay.status).toBe(200);
    const replayJson = (await replay.json()) as { ok: boolean; latestSeq: number };
    expect(replayJson.ok).toBe(true);
    expect(replayJson.latestSeq).toBe(5);
  });

  it("400 when messages array is missing", async () => {
    const res = await postMessages(machineToken, {});
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// Claim response shape — the daemon needs trigger comment, autopilot context,
// repos, and joined agent skills surfaced on the claim payload so it can render
// CLAUDE.md without round-trips. Each variant gets its own test.
// =============================================================================

describe("POST /api/daemon/runtimes/:runtimeId/tasks/claim — response shape", () => {
  let workspaceId: string;
  let userId: string;
  let agentId: string;
  let runtimeId: string;
  let machineToken: string;
  let issueId: string;

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const [u] = await db
      .insert(users)
      .values({ email: `dclm-${stamp}@x`, name: "DC" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    userId = u!.id;
    const repos = [{ url: "https://github.com/example/repo" }, "https://github.com/legacy/string"];
    const [w] = await db
      .insert(workspaces)
      .values({
        name: "DC",
        slug: `dc-${stamp}`,
        issuePrefix: "DC",
        repos,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    workspaceId = w!.id;
    const [m] = await db.insert(members).values({ workspaceId, userId, role: "owner" }).returning();
    const tok = generateMachineToken();
    machineToken = tok.token;
    const [r] = await db
      .insert(runtimes)
      .values({
        workspaceId,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        memberId: m!.id,
        name: `rt-${stamp}`,
        machineTokenHash: tok.hash,
        daemonVersion: "0.0.1",
        online: true,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    runtimeId = r!.id;
    const [a] = await db
      .insert(agents)
      .values({
        workspaceId,
        name: "dc-agent",
        runtimeId,
        cliKind: "claude_code",
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    agentId = a!.id;

    const [issue] = await db
      .insert(issues)
      .values({
        workspaceId,
        number: 1,
        title: "claim me",
        creatorKind: "member",
        creatorId: userId,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    issueId = issue!.id;
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
  });

  function claim() {
    return daemonRouter.request(`/api/daemon/runtimes/${runtimeId}/tasks/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${machineToken}`,
      },
      body: JSON.stringify({}),
    });
  }

  it("response includes triggerComment when task has triggerCommentId", async () => {
    const [comment] = await db
      .insert(comments)
      .values({
        issueId,
        authorKind: "member",
        authorId: userId,
        content: "please look at this",
      })
      .returning();
    await db.insert(agentTaskQueue).values({
      workspaceId,
      agentId,
      runtimeId,
      issueId,
      // biome-ignore lint/style/noNonNullAssertion: test setup
      triggerCommentId: comment!.id,
      triggerSummary: "mentioned in comment",
    });

    const res = await claim();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      task: {
        triggerComment: {
          id: string;
          content: string;
          authorKind: "member" | "agent";
          authorName: string;
          createdAt: string;
        } | null;
      };
    };
    expect(json.task.triggerComment).toBeTruthy();
    // biome-ignore lint/style/noNonNullAssertion: asserted truthy above
    expect(json.task.triggerComment!.content).toBe("please look at this");
    // biome-ignore lint/style/noNonNullAssertion: asserted truthy above
    expect(json.task.triggerComment!.authorKind).toBe("member");
    // biome-ignore lint/style/noNonNullAssertion: asserted truthy above
    expect(json.task.triggerComment!.authorName).toBe("DC");
  });

  it("response includes autopilot fields when task is linked to an autopilot run", async () => {
    const [ap] = await db
      .insert(autopilots)
      .values({
        workspaceId,
        title: "AP for claim",
        description: "ap desc",
        assigneeId: agentId,
        executionMode: "run_only",
        createdByKind: "member",
        createdById: userId,
      })
      .returning();
    const [run] = await db
      .insert(autopilotRuns)
      .values({
        // biome-ignore lint/style/noNonNullAssertion: test setup
        autopilotId: ap!.id,
        source: "manual",
        status: "running",
        triggerPayload: { kind: "manual" },
      })
      .returning();
    await db.insert(agentTaskQueue).values({
      workspaceId,
      agentId,
      runtimeId,
      // biome-ignore lint/style/noNonNullAssertion: test setup
      autopilotRunId: run!.id,
      originType: "autopilot",
      // biome-ignore lint/style/noNonNullAssertion: test setup
      originId: ap!.id,
      triggerSummary: "autopilot: AP for claim",
    });

    const res = await claim();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      task: {
        autopilotRunId: string | null;
        autopilotId: string | null;
        autopilotTitle: string | null;
        autopilotDescription: string | null;
        autopilotSource: string | null;
        autopilotTriggerPayload: string | null;
      };
    };
    // biome-ignore lint/style/noNonNullAssertion: test setup
    expect(json.task.autopilotRunId).toBe(run!.id);
    // biome-ignore lint/style/noNonNullAssertion: test setup
    expect(json.task.autopilotId).toBe(ap!.id);
    expect(json.task.autopilotTitle).toBe("AP for claim");
    expect(json.task.autopilotDescription).toBe("ap desc");
    expect(json.task.autopilotSource).toBe("manual");
    expect(json.task.autopilotTriggerPayload).toContain("manual");
  });

  it("response includes repos array normalized to { url }", async () => {
    await db.insert(agentTaskQueue).values({
      workspaceId,
      agentId,
      runtimeId,
      issueId,
      triggerSummary: "for repos",
    });
    const res = await claim();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { repos: { url: string }[] };
    expect(Array.isArray(json.repos)).toBe(true);
    // Two repos seeded: one object, one string — both normalized to { url }.
    expect(json.repos.length).toBe(2);
    for (const r of json.repos) {
      expect(typeof r.url).toBe("string");
    }
  });

  it("response includes agentSkills joined on skill.name", async () => {
    const [skill] = await db
      .insert(skills)
      .values({
        workspaceId,
        ownerId: userId,
        name: "claim-skill",
        description: "for claim test",
        content: "# body",
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    await db.insert(agentSkills).values({ agentId, skillId: skill!.id });
    await db.insert(agentTaskQueue).values({
      workspaceId,
      agentId,
      runtimeId,
      issueId,
      triggerSummary: "for skills",
    });

    const res = await claim();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { agentSkills: { name: string }[] };
    expect(Array.isArray(json.agentSkills)).toBe(true);
    expect(json.agentSkills.map((s) => s.name)).toContain("claim-skill");
  });

  it("response carries the agent owner's decrypted GitHub token", async () => {
    process.env.AGORA_TOKEN_ENCRYPTION_KEY = "daemon-test-key-with-enough-entropy-32+";
    _resetKeyCache();
    // The claim agent must be owned by a user who has a GitHub connection.
    await db.update(agents).set({ ownerId: userId }).where(sql`id = ${agentId}`);
    await db.insert(userConnections).values({
      userId,
      kind: "github",
      status: "connected",
      config: { access_token: encryptToken("ghp_test_token_123") },
      connectedAt: new Date(),
    });
    await db.insert(agentTaskQueue).values({
      workspaceId,
      agentId,
      runtimeId,
      issueId,
      triggerSummary: "for github token",
    });

    const res = await claim();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { githubToken: string | null };
    expect(json.githubToken).toBe("ghp_test_token_123");
  });

  it("githubToken is null when the agent owner has no GitHub connection", async () => {
    await db.insert(agentTaskQueue).values({
      workspaceId,
      agentId,
      runtimeId,
      issueId,
      triggerSummary: "no github connection",
    });
    const res = await claim();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { githubToken: string | null };
    expect(json.githubToken).toBeNull();
  });
});

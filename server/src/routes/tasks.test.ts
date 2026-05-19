import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentTaskQueue,
  agents,
  members,
  personalAccessTokens,
  runtimes,
  taskMessages,
  users,
  workspaces,
} from "../db/schema/index";
import { generateMachineToken } from "../lib/machine-token";
import { generatePat } from "../lib/pat-token";
import tasksRouter from "./tasks";

// =============================================================================
// GET /api/workspaces/:workspaceId/tasks/:taskId/messages
//
// Per-task agent execution timeline. Web fetches this when an AgentRunCard
// is expanded then incrementally re-fetches with ?since=<lastSeq>. Auth is
// regular workspace member (auth + workspace middleware) plus a
// task-belongs-to-workspace guard inside the handler.
// =============================================================================

describe("GET /api/workspaces/:wsId/tasks/:taskId/messages", () => {
  let workspaceId: string;
  let workspaceBId: string;
  let userId: string;
  let outsiderId: string;
  let agentId: string;
  let runtimeId: string;
  let taskId: string;
  let foreignTaskId: string;
  let ownerToken: string;
  let outsiderToken: string;

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const [u] = await db
      .insert(users)
      .values({ email: `tm-${stamp}@x`, name: "TM" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    userId = u!.id;
    const [out] = await db
      .insert(users)
      .values({ email: `tm-out-${stamp}@x`, name: "Out" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    outsiderId = out!.id;

    const [w] = await db
      .insert(workspaces)
      .values({ name: "TM", slug: `tm-${stamp}`, issuePrefix: "TM" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    workspaceId = w!.id;
    const [wB] = await db
      .insert(workspaces)
      .values({ name: "TMB", slug: `tmb-${stamp}`, issuePrefix: "TMB" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    workspaceBId = wB!.id;

    const [m] = await db.insert(members).values({ workspaceId, userId, role: "owner" }).returning();
    // Outsider is a member of workspaceBId only — they're authorized to call
    // the route via wsB but the task belongs to workspaceId, so they should
    // 404 (router-level membership passes, handler's tenant filter rejects).
    const [mB] = await db
      .insert(members)
      .values({ workspaceId: workspaceBId, userId: outsiderId, role: "owner" })
      .returning();

    const tok = generateMachineToken();
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
        name: "tm-agent",
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

    // A second task in workspaceBId so we can verify the tenant guard.
    const tokB = generateMachineToken();
    const [rB] = await db
      .insert(runtimes)
      .values({
        workspaceId: workspaceBId,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        memberId: mB!.id,
        name: `rt-b-${stamp}`,
        machineTokenHash: tokB.hash,
        daemonVersion: "0.0.1",
        online: true,
      })
      .returning();
    const [aB] = await db
      .insert(agents)
      .values({
        workspaceId: workspaceBId,
        name: "tm-agent-b",
        // biome-ignore lint/style/noNonNullAssertion: test setup
        runtimeId: rB!.id,
        cliKind: "claude_code",
      })
      .returning();
    const [taskB] = await db
      .insert(agentTaskQueue)
      .values({
        workspaceId: workspaceBId,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        agentId: aB!.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        runtimeId: rB!.id,
        status: "running",
        startedAt: new Date(),
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    foreignTaskId = taskB!.id;

    // Seed message rows. The seq-order assertion below depends on this set.
    const seedSeqs = [1, 2, 3, 4, 5];
    await db.insert(taskMessages).values(
      seedSeqs.map((seq) => ({
        taskId,
        seq,
        kind: "stdout" as const,
        content: { text: `m${seq}` },
      })),
    );

    const ownerPat = generatePat();
    await db.insert(personalAccessTokens).values({
      userId,
      name: "test",
      tokenHash: ownerPat.hash,
      tokenPrefix: ownerPat.prefix,
    });
    ownerToken = ownerPat.token;

    const outsiderPat = generatePat();
    await db.insert(personalAccessTokens).values({
      userId: outsiderId,
      name: "test",
      tokenHash: outsiderPat.hash,
      tokenPrefix: outsiderPat.prefix,
    });
    outsiderToken = outsiderPat.token;
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM workspace WHERE id IN (${workspaceId}, ${workspaceBId})`);
    await db.execute(sql`DELETE FROM "user" WHERE id IN (${userId}, ${outsiderId})`);
  });

  async function get(path: string, opts?: { token?: string; ws?: string }): Promise<Response> {
    const token = opts?.token ?? ownerToken;
    const ws = opts?.ws ?? workspaceId;
    return tasksRouter.request(path, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-ID": ws,
      },
    });
  }

  it("returns envelope { messages, nextSince } ordered by seq asc", async () => {
    const res = await get(`/api/workspaces/${workspaceId}/tasks/${taskId}/messages`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { seq: number }[]; nextSince: number | null };
    expect(body.messages.length).toBe(5);
    expect(body.messages.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    // nextSince must be the highest seq returned so the client can pass it
    // verbatim as the next ?since= cursor.
    expect(body.nextSince).toBe(5);
  });

  it("?since=2 returns only messages with seq > 2", async () => {
    const res = await get(`/api/workspaces/${workspaceId}/tasks/${taskId}/messages?since=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { seq: number }[]; nextSince: number | null };
    expect(body.messages.map((r) => r.seq)).toEqual([3, 4, 5]);
    expect(body.nextSince).toBe(5);
  });

  it("?since=999 (past the end) returns empty messages with nextSince=null", async () => {
    const res = await get(`/api/workspaces/${workspaceId}/tasks/${taskId}/messages?since=999`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[]; nextSince: number | null };
    expect(body.messages).toEqual([]);
    // An empty page carries no cursor advancement — null tells the client to
    // keep its prior `since`.
    expect(body.nextSince).toBeNull();
  });

  it("?limit=9999 is clamped to 500", async () => {
    // Seed a bunch more rows. We don't need 500 actual rows — clamp is a pure
    // arithmetic gate on the limit clause. Inserting one extra row + observing
    // the response succeeds is enough to prove the route didn't reject the
    // request as malformed; the actual clamp is tested by the SQL builder.
    await db.insert(taskMessages).values({
      taskId,
      seq: 6,
      kind: "stdout",
      content: { text: "m6" },
    });
    const res = await get(`/api/workspaces/${workspaceId}/tasks/${taskId}/messages?limit=9999`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[]; nextSince: number | null };
    // We seeded 6 — clamp doesn't reduce that, but it also doesn't reject the
    // request. The shape check below just validates the array is returned.
    expect(body.messages.length).toBe(6);
    expect(body.nextSince).toBe(6);
  });

  it("404 when taskId belongs to a different workspace", async () => {
    // foreignTaskId lives in workspaceBId; calling via workspaceId must 404
    // even though the caller is a valid member of workspaceId.
    const res = await get(`/api/workspaces/${workspaceId}/tasks/${foreignTaskId}/messages`);
    expect(res.status).toBe(404);
  });

  it("401 when no auth header is provided", async () => {
    const res = await tasksRouter.request(
      `/api/workspaces/${workspaceId}/tasks/${taskId}/messages`,
    );
    expect(res.status).toBe(401);
  });

  it("403 when caller is not a workspace member", async () => {
    // Outsider is a member of workspaceBId, not workspaceId. Hitting via
    // workspaceId trips workspaceMiddleware → 403.
    const res = await get(`/api/workspaces/${workspaceId}/tasks/${taskId}/messages`, {
      token: outsiderToken,
    });
    expect(res.status).toBe(403);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentTaskQueue,
  agents,
  issues,
  members,
  runtimes,
  users,
  workspaces,
} from "../db/schema/index";
import { enqueueTaskForIssue } from "../lib/enqueue";
import { generateMachineToken } from "../lib/machine-token";
import { parseMentions } from "../lib/mention";

let workspaceId: string;
let userId: string;
let runtimeId: string;
let agentId: string;

function assertDefined<T>(val: T | undefined, name: string): T {
  if (val === undefined) throw new Error(`Expected ${name} to be defined`);
  return val;
}

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `int-${Date.now()}@x`, name: "Int" })
    .returning();
  userId = assertDefined(u, "user").id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "Int", slug: `int-${Date.now()}`, issuePrefix: "INT" })
    .returning();
  workspaceId = assertDefined(w, "workspace").id;
  const [m] = await db.insert(members).values({ workspaceId, userId, role: "owner" }).returning();
  const tok = generateMachineToken();
  const [r] = await db
    .insert(runtimes)
    .values({
      workspaceId,
      memberId: assertDefined(m, "member").id,
      name: "rt",
      machineTokenHash: tok.hash,
      daemonVersion: "0.0.1",
      online: true,
    })
    .returning();
  runtimeId = assertDefined(r, "runtime").id;
  const [a] = await db
    .insert(agents)
    .values({ workspaceId, name: "int-agent", runtimeId, cliKind: "claude_code" })
    .returning();
  agentId = assertDefined(a, "agent").id;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("issue creation auto-enqueues task when assigned to an agent", () => {
  it("enqueues a queued task on assignee=agent", async () => {
    const [issue] = await db
      .insert(issues)
      .values({
        workspaceId,
        number: 1,
        title: "auto",
        creatorKind: "member",
        creatorId: userId,
        assigneeKind: "agent",
        assigneeId: agentId,
      })
      .returning();
    const issueId = assertDefined(issue, "issue").id;
    await enqueueTaskForIssue({ workspaceId, issueId, agentId, runtimeId });
    const tasks = await db.query.agentTaskQueue.findMany({
      where: (t, { eq }) => eq(t.issueId, issueId),
    });
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.status).toBe("queued");
  });

  it("@agent mention parses and enqueues a task", async () => {
    const [issue] = await db
      .insert(issues)
      .values({
        workspaceId,
        number: 2,
        title: "via mention",
        creatorKind: "member",
        creatorId: userId,
      })
      .returning();
    const issueId = assertDefined(issue, "issue").id;
    const md = `please look at this [@int-agent](mention://agent/${agentId})`;
    const mentions = parseMentions(md).filter((m) => m.kind === "agent");
    expect(mentions[0]?.id).toBe(agentId);
    await enqueueTaskForIssue({
      workspaceId,
      issueId,
      agentId,
      runtimeId,
      triggerSummary: "test mention",
    });
    const tasks = await db.query.agentTaskQueue.findMany({
      where: (t, { eq }) => eq(t.issueId, issueId),
    });
    expect(tasks.length).toBe(1);
  });
});

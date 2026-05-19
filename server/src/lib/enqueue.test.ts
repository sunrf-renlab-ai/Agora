import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentTaskQueue,
  agents,
  chatSessions,
  issues,
  members,
  runtimes,
  users,
  workspaces,
} from "../db/schema/index";
import { claimNextTaskForRuntime, enqueueTaskForChat, enqueueTaskForIssue } from "./enqueue";
import { generateMachineToken } from "./machine-token";

let workspaceId: string;
let userId: string;
let memberId: string;
let runtimeId: string;
let agentId: string;
let issueId: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `e6-${Date.now()}@x`, name: "Tester" })
    .returning();
  userId = u?.id as string;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "P3", slug: `p3-${Date.now()}`, issuePrefix: "P3" })
    .returning();
  workspaceId = w?.id as string;
  const [m] = await db.insert(members).values({ workspaceId, userId, role: "owner" }).returning();
  memberId = m?.id as string;
  const tok = generateMachineToken();
  const [r] = await db
    .insert(runtimes)
    .values({
      workspaceId,
      memberId,
      name: "test-rt",
      machineTokenHash: tok.hash,
      daemonVersion: "0.0.1",
      online: true,
    })
    .returning();
  runtimeId = r?.id as string;
  const [a] = await db
    .insert(agents)
    .values({ workspaceId, name: "tester-agent", runtimeId, cliKind: "claude_code" })
    .returning();
  agentId = a?.id as string;
  const [issue] = await db
    .insert(issues)
    .values({
      workspaceId,
      number: 1,
      title: "do thing",
      creatorKind: "member",
      creatorId: userId,
    })
    .returning();
  issueId = issue?.id as string;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("enqueueTaskForIssue + claim", () => {
  it("inserts a queued task then atomically claims it", async () => {
    const task = await enqueueTaskForIssue({ workspaceId, issueId, agentId, runtimeId });
    expect(task.status).toBe("queued");

    const claimed = await claimNextTaskForRuntime(runtimeId);
    expect(claimed?.id).toBe(task.id);
    expect(claimed?.status).toBe("dispatched");
  });

  it("blocks a duplicate active task per (issue) via partial unique index", async () => {
    await enqueueTaskForIssue({ workspaceId, issueId, agentId, runtimeId });
    await expect(
      enqueueTaskForIssue({ workspaceId, issueId, agentId, runtimeId }),
    ).rejects.toThrow();
  });
});

describe("enqueueTaskForChat", () => {
  it("inserts a chat task with chatSessionId, no issueId, and quickCreatePrompt", async () => {
    const [session] = await db
      .insert(chatSessions)
      .values({
        workspaceId,
        agentId,
        creatorId: userId,
        runtimeId,
        title: "test chat",
      })
      .returning();
    const sessionId = session?.id as string;

    const task = await enqueueTaskForChat({
      workspaceId,
      chatSessionId: sessionId,
      agentId,
      runtimeId,
      prompt: "hello agent",
    });

    expect(task.status).toBe("queued");
    expect(task.chatSessionId).toBe(sessionId);
    expect(task.issueId).toBeNull();
    expect(task.quickCreatePrompt).toBe("hello agent");

    const rows = await db.select().from(agentTaskQueue).where(eq(agentTaskQueue.id, task.id));
    expect(rows[0]?.chatSessionId).toBe(sessionId);
  });

  it("blocks a duplicate active task per (chat session) via partial unique index", async () => {
    const [session] = await db
      .insert(chatSessions)
      .values({
        workspaceId,
        agentId,
        creatorId: userId,
        runtimeId,
        title: "test chat",
      })
      .returning();
    const sessionId = session?.id as string;

    await enqueueTaskForChat({
      workspaceId,
      chatSessionId: sessionId,
      agentId,
      runtimeId,
      prompt: "first",
    });
    await expect(
      enqueueTaskForChat({
        workspaceId,
        chatSessionId: sessionId,
        agentId,
        runtimeId,
        prompt: "second",
      }),
    ).rejects.toThrow();
  });
});

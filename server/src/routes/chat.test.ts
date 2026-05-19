import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentTaskQueue,
  agents,
  chatMessages,
  chatSessions,
  members,
  runtimes,
  users,
  workspaces,
} from "../db/schema/index";
import { generateMachineToken } from "../lib/machine-token";
import { appendAssistantReply, sendChatMessage } from "../services/chat";
import chatRouter from "./chat";

let workspaceId: string;
let userId: string;
let agentId: string;
let runtimeId: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `chat-${Date.now()}@x`, name: "Chat" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "Chat", slug: `chat-${Date.now()}`, issuePrefix: "CH" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  workspaceId = w!.id;
  const [m] = await db.insert(members).values({ workspaceId, userId, role: "owner" }).returning();
  const tok = generateMachineToken();
  const [r] = await db
    .insert(runtimes)
    .values({
      workspaceId,
      // biome-ignore lint/style/noNonNullAssertion: test setup
      memberId: m!.id,
      name: "rt",
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
      name: "chat-agent",
      runtimeId,
      cliKind: "claude_code",
    })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  agentId = a!.id;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("chat routes auth", () => {
  it("returns 401 without auth", async () => {
    const res = await chatRouter.request(`/api/workspaces/${workspaceId}/chat/sessions`);
    expect(res.status).toBe(401);
  });
});

describe("sendChatMessage service", () => {
  it("inserts user message + enqueues a chat task", async () => {
    const [s] = await db
      .insert(chatSessions)
      .values({ workspaceId, agentId, creatorId: userId, title: "Hi" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const sessionId = s!.id;

    const result = await sendChatMessage({
      workspaceId,
      sessionId,
      userId,
      content: "What is 2+2?",
    });
    expect(result.message.role).toBe("user");
    expect(result.message.content).toBe("What is 2+2?");
    expect(result.taskId).toBeTruthy();

    const tasks = await db.query.agentTaskQueue.findMany({
      where: eq(agentTaskQueue.chatSessionId, sessionId),
    });
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.status).toBe("queued");
  });

  it("appendAssistantReply inserts assistant message", async () => {
    const [s] = await db
      .insert(chatSessions)
      .values({ workspaceId, agentId, creatorId: userId, title: "Hi" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const sessionId = s!.id;

    await appendAssistantReply({
      workspaceId,
      sessionId,
      taskId: "00000000-0000-0000-0000-000000000001",
      content: "4",
      elapsedMs: 250,
    });

    const msgs = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.chatSessionId, sessionId));
    expect(msgs.length).toBe(1);
    expect(msgs[0]?.role).toBe("assistant");
    expect(msgs[0]?.content).toBe("4");
    expect(msgs[0]?.elapsedMs).toBe(250);
  });
});

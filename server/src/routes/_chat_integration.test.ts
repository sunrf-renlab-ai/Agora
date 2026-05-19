import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agents,
  chatMessages,
  chatSessions,
  members,
  runtimes,
  users,
  workspaces,
} from "../db/schema/index";
import { claimNextTaskForRuntime } from "../lib/enqueue";
import { generateMachineToken } from "../lib/machine-token";
import { sendChatMessage } from "../services/chat";
import daemonRouter from "./daemon";

let workspaceId: string;
let userId: string;
let runtimeId: string;
let agentId: string;
let machineToken: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `chat-${Date.now()}@x`, name: "Chatter" })
    .returning();
  userId = u?.id as string;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "Chat", slug: `chat-${Date.now()}`, issuePrefix: "CH" })
    .returning();
  workspaceId = w?.id as string;
  const [m] = await db.insert(members).values({ workspaceId, userId, role: "owner" }).returning();
  const tok = generateMachineToken();
  machineToken = tok.token;
  const [r] = await db
    .insert(runtimes)
    .values({
      workspaceId,
      memberId: m?.id as string,
      name: "rt",
      machineTokenHash: tok.hash,
      daemonVersion: "0.0.1",
      online: true,
    })
    .returning();
  runtimeId = r?.id as string;
  const [a] = await db
    .insert(agents)
    .values({
      workspaceId,
      name: "chat-agent",
      runtimeId,
      cliKind: "claude_code",
      instructions: "You are helpful.",
    })
    .returning();
  agentId = a?.id as string;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("chat full flow", () => {
  it("user message → task queued → daemon-complete with reply → assistant message", async () => {
    const [session] = await db
      .insert(chatSessions)
      .values({ workspaceId, agentId, creatorId: userId, title: "test" })
      .returning();
    const sessionId = session?.id as string;

    // 1) User sends a message → service path.
    const sendResult = await sendChatMessage({
      workspaceId,
      sessionId,
      userId,
      content: "Tell me a joke.",
    });
    expect(sendResult.message.content).toBe("Tell me a joke.");

    // 2) Daemon claims it.
    const task = await claimNextTaskForRuntime(runtimeId);
    expect(task).toBeTruthy();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    expect(task!.chatSessionId).toBe(sessionId);
    // enqueueTaskForChat passes the *built prompt* (instructions + history),
    // so we just check it's non-empty and contains the user message.
    // biome-ignore lint/style/noNonNullAssertion: test setup
    expect(task!.quickCreatePrompt ?? "").toContain("Tell me a joke.");

    // 3) Mark task running (daemon /start).
    await db
      .update((await import("../db/schema/index")).agentTaskQueue)
      .set({ status: "running", startedAt: new Date() })
      // biome-ignore lint/style/noNonNullAssertion: test setup
      .where(eq((await import("../db/schema/index")).agentTaskQueue.id, task!.id));

    // 4) Simulate daemon /complete with a chat reply by hitting the route.
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const completeRes = await daemonRouter.request(`/api/daemon/tasks/${task!.id}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${machineToken}`,
      },
      body: JSON.stringify({
        result: { exitCode: 0, reply: "Why did the chicken cross the road?" },
        sessionId: "claude-cli-sess-1",
        workDir: "/tmp/chat-x",
      }),
    });
    expect(completeRes.status).toBe(200);

    // 5) Assistant message should now exist.
    const all = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.chatSessionId, sessionId));
    expect(all).toHaveLength(2);
    const assistant = all.find((m) => m.role === "assistant");
    expect(assistant?.content).toBe("Why did the chicken cross the road?");
    // biome-ignore lint/style/noNonNullAssertion: test setup
    expect(assistant?.taskId).toBe(task!.id);

    // 6) Chat session captures CLI session id for resume.
    const refreshed = await db.query.chatSessions.findFirst({
      where: eq(chatSessions.id, sessionId),
    });
    expect(refreshed?.sessionId).toBe("claude-cli-sess-1");
    expect(refreshed?.workDir).toBe("/tmp/chat-x");
  });

  it("daemon /fail on a chat task synthesizes an assistant failure message", async () => {
    const [session] = await db
      .insert(chatSessions)
      .values({ workspaceId, agentId, creatorId: userId, title: "fail-test" })
      .returning();
    const sessionId = session?.id as string;

    await sendChatMessage({ workspaceId, sessionId, userId, content: "ping" });
    const task = await claimNextTaskForRuntime(runtimeId);
    await db
      .update((await import("../db/schema/index")).agentTaskQueue)
      .set({ status: "running", startedAt: new Date() })
      // biome-ignore lint/style/noNonNullAssertion: test setup
      .where(eq((await import("../db/schema/index")).agentTaskQueue.id, task!.id));

    // biome-ignore lint/style/noNonNullAssertion: test setup
    await daemonRouter.request(`/api/daemon/tasks/${task!.id}/fail`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${machineToken}`,
      },
      body: JSON.stringify({ error: "CLI exploded", failureReason: "agent_error" }),
    });

    const msgs = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.chatSessionId, sessionId));
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant?.failureReason).toBe("agent_error");
    expect(assistant?.content).toBe("CLI exploded");
  });
});

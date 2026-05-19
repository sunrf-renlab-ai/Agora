import {
  createChatSessionSchema,
  sendChatMessageSchema,
  updateChatSessionSchema,
} from "@agora/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { agents, chatSessions } from "../db/schema/index";
import { jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";
import { listMessages, sendChatMessage } from "../services/chat";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

app.get("/api/workspaces/:workspaceId/chat/sessions", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const rows = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.workspaceId, workspaceId), eq(chatSessions.creatorId, user.id)))
    .orderBy(desc(chatSessions.updatedAt));
  return c.json(rows);
});

app.post("/api/workspaces/:workspaceId/chat/sessions", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const parsed = createChatSessionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, parsed.data.agentId), eq(agents.workspaceId, workspaceId)),
  });
  if (!agent) return jsonError(c, 404, "agent not found");
  if (agent.archivedAt) return jsonError(c, 400, "agent is archived");
  const [session] = await db
    .insert(chatSessions)
    .values({
      workspaceId,
      agentId: agent.id,
      creatorId: user.id,
      title: parsed.data.title,
    })
    .returning();
  if (!session) return jsonError(c, 500, "failed to create chat session");
  broadcastWorkspace(workspaceId, {
    type: "chat.session_created",
    data: { id: session.id, workspaceId },
  });
  return c.json(session, 201);
});

app.patch("/api/workspaces/:workspaceId/chat/sessions/:sessionId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");
  const parsed = updateChatSessionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, sessionId), eq(chatSessions.workspaceId, workspaceId)),
  });
  if (!session) return notFound(c, "Chat session");
  if (session.creatorId !== user.id) return jsonError(c, 403, "not your chat session");
  const [updated] = await db
    .update(chatSessions)
    .set({ title: parsed.data.title, updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId))
    .returning();
  if (!updated) return notFound(c, "Chat session");
  broadcastWorkspace(workspaceId, {
    type: "chat.session_updated",
    data: { id: updated.id, workspaceId },
  });
  return c.json(updated);
});

app.delete("/api/workspaces/:workspaceId/chat/sessions/:sessionId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, sessionId), eq(chatSessions.workspaceId, workspaceId)),
  });
  if (!session) return notFound(c, "Chat session");
  if (session.creatorId !== user.id) return jsonError(c, 403, "not your chat session");
  // Cascade FK on chat_message handles message rows; ON DELETE SET NULL on
  // agent_task_queue.chat_session_id (set in schema/tasks.ts) leaves any in-flight
  // task in place — its complete callback will then fall through the
  // "session missing" branch and be a no-op.
  await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
  broadcastWorkspace(workspaceId, {
    type: "chat.session_deleted",
    data: { id: sessionId, workspaceId },
  });
  return c.body(null, 204);
});

app.get("/api/workspaces/:workspaceId/chat/sessions/:sessionId/messages", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");
  try {
    const rows = await listMessages(workspaceId, sessionId, user.id);
    return c.json(rows);
  } catch (e) {
    return jsonError(c, 404, (e as Error).message);
  }
});

app.post("/api/workspaces/:workspaceId/chat/sessions/:sessionId/messages", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");
  const parsed = sendChatMessageSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  try {
    const result = await sendChatMessage({
      workspaceId,
      sessionId,
      userId: user.id,
      content: parsed.data.content,
    });
    return c.json(result, 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "chat session not found") return notFound(c, "Chat session");
    if (msg === "not your chat session") return jsonError(c, 403, msg);
    if (msg === "chat session is archived") return jsonError(c, 400, msg);
    return jsonError(c, 500, msg);
  }
});

export default app;

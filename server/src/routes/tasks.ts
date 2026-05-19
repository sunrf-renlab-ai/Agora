import { cancelTaskSchema } from "@agora/shared";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { agentTaskQueue, taskMessages } from "../db/schema/index";
import { jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

app.get("/api/workspaces/:workspaceId/issues/:issueId/tasks", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");
  const rows = await db.query.agentTaskQueue.findMany({
    where: and(eq(agentTaskQueue.issueId, issueId), eq(agentTaskQueue.workspaceId, workspaceId)),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 50,
  });
  return c.json(rows);
});

// Per-task agent execution timeline. Web fetches this when an
// AgentRunCard is expanded, then refetches with ?since=<lastSeq> on every
// `task.messages_appended` WS event. Auth: regular workspace member
// (handled by the router-level authMiddleware + workspaceMiddleware), and
// we verify the task itself belongs to the workspace so a taskId from
// another workspace can't be read by URL-swapping.
app.get("/api/workspaces/:workspaceId/tasks/:taskId/messages", async (c) => {
  const workspaceId = c.get("workspaceId");
  const taskId = c.req.param("taskId");

  const task = await db.query.agentTaskQueue.findFirst({
    where: and(eq(agentTaskQueue.id, taskId), eq(agentTaskQueue.workspaceId, workspaceId)),
  });
  if (!task) return notFound(c, "Task");

  const sinceRaw = c.req.query("since");
  const since = sinceRaw !== undefined ? Number.parseInt(sinceRaw, 10) : 0;
  if (Number.isNaN(since) || since < 0) return jsonError(c, 400, "invalid since parameter");

  const limitRaw = c.req.query("limit");
  const requested = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : 200;
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(500, requested)) : 200;

  const rows = await db
    .select()
    .from(taskMessages)
    .where(and(eq(taskMessages.taskId, taskId), gt(taskMessages.seq, since)))
    .orderBy(asc(taskMessages.seq))
    .limit(limit);

  // Envelope shape: `nextSince` is the highest seq returned (or null when
  // the page is empty) so the client can pass it verbatim as the next
  // ?since= without recomputing. A bare array would force every caller to
  // reduce-max on the response, and there'd be no clear answer when empty.
  const nextSince = rows.length > 0 ? (rows[rows.length - 1]?.seq ?? null) : null;
  return c.json({ messages: rows, nextSince });
});

app.post("/api/workspaces/:workspaceId/tasks/:taskId/cancel", async (c) => {
  const workspaceId = c.get("workspaceId");
  const taskId = c.req.param("taskId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelTaskSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const [t] = await db
    .update(agentTaskQueue)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(agentTaskQueue.id, taskId),
        eq(agentTaskQueue.workspaceId, workspaceId),
        inArray(agentTaskQueue.status, ["queued", "dispatched", "running"]),
      ),
    )
    .returning();
  if (!t) return notFound(c, "Task");
  broadcastWorkspace(workspaceId, { type: "task.cancelled", data: { id: t.id } });
  return c.json(t);
});

export default app;

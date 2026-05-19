import { quickCreateIssueSchema } from "@agora/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { agents } from "../db/schema/index";
import { daemonHub } from "../lib/daemon-hub";
import { enqueueQuickCreateTask } from "../lib/enqueue";
import { jsonError } from "../lib/errors";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

app.post("/api/workspaces/:workspaceId/issues/quick-create", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const body = await c.req.json();
  const parsed = quickCreateIssueSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, parsed.data.agentId), eq(agents.workspaceId, workspaceId)),
  });
  if (!agent || agent.archivedAt) {
    return c.json({ error: "Agent not found", code: "agent_unavailable" }, 404);
  }
  if (!agent.runtimeId) {
    return c.json({ error: "Agent has no runtime configured", code: "agent_unavailable" }, 422);
  }
  if (!daemonHub.isOnline(agent.runtimeId)) {
    return c.json({ error: "Agent's runtime is offline", code: "agent_unavailable" }, 422);
  }
  if (agent.visibility === "private" && agent.ownerId !== user.id && role === "member") {
    return jsonError(c, 403, "Forbidden");
  }
  const task = await enqueueQuickCreateTask({
    workspaceId,
    agentId: agent.id,
    runtimeId: agent.runtimeId,
    prompt: parsed.data.prompt,
    requesterId: user.id,
  });
  return c.json({ taskId: task.id }, 202);
});

export default app;

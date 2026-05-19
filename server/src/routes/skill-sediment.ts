import { Hono } from "hono";
import { taskAuthMiddleware } from "../middleware/task-auth";
import { sedimentSkillFromTask } from "../services/skill-sediment";

const app = new Hono();

app.use("/api/daemon/tasks/:taskId/sediment-skill", taskAuthMiddleware);
app.post("/api/daemon/tasks/:taskId/sediment-skill", async (c) => {
  const taskId = c.req.param("taskId");
  const authedTaskId = c.get("taskId");
  if (!authedTaskId || authedTaskId !== taskId) {
    return c.json({ error: "task id mismatch" }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { content?: unknown };
  if (typeof body.content !== "string" || body.content.length === 0) {
    return c.json({ error: "content is required" }, 400);
  }
  if (body.content.length > 1 << 20) {
    return c.json({ error: "content too large" }, 413);
  }
  const skillId = await sedimentSkillFromTask({ taskId, rawContent: body.content });
  if (!skillId) {
    return c.json({ ok: true, sedimented: false }, 200);
  }
  return c.json({ ok: true, sedimented: true, skillId }, 201);
});

export default app;

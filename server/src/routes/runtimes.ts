import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { runtimes } from "../db/schema/index";
import { daemonHub } from "../lib/daemon-hub";
import { jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

function runtimeToJson(r: typeof runtimes.$inferSelect) {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    memberId: r.memberId,
    name: r.name,
    daemonVersion: r.daemonVersion,
    detectedClis: r.detectedClis,
    online: r.online && daemonHub.isOnline(r.id),
    lastHeartbeatAt: r.lastHeartbeatAt?.toISOString() ?? null,
    runtimeInfo: r.runtimeInfo,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

app.get("/api/workspaces/:workspaceId/runtimes", async (c) => {
  const workspaceId = c.get("workspaceId");
  const rows = await db.query.runtimes.findMany({ where: eq(runtimes.workspaceId, workspaceId) });
  return c.json(rows.map(runtimeToJson));
});

app.delete("/api/workspaces/:workspaceId/runtimes/:runtimeId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const role = c.get("memberRole");
  if (role === "member") return jsonError(c, 403, "Forbidden");
  const runtimeId = c.req.param("runtimeId");
  const [r] = await db
    .delete(runtimes)
    .where(and(eq(runtimes.id, runtimeId), eq(runtimes.workspaceId, workspaceId)))
    .returning();
  if (!r) return notFound(c, "Runtime");
  broadcastWorkspace(workspaceId, { type: "runtime.offline", data: { id: r.id, workspaceId } });
  return c.body(null, 204);
});

export default app;

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { activityLog, issues, users } from "../db/schema/index";
import { notFound } from "../lib/errors";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

// GET /api/workspaces/:workspaceId/issues/:issueId/activity
app.get("/api/workspaces/:workspaceId/issues/:issueId/activity", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const rows = await db.query.activityLog.findMany({
    where: and(eq(activityLog.workspaceId, workspaceId), eq(activityLog.issueId, issueId)),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
    limit: 200,
  });

  const result = await Promise.all(
    rows.map(async (r) => {
      let actor = null;
      if (r.actorId) {
        const u = await db.query.users.findFirst({ where: eq(users.id, r.actorId) });
        if (u) actor = { id: u.id, name: u.name, avatarUrl: u.avatarUrl };
      }
      return {
        id: r.id,
        workspaceId: r.workspaceId,
        issueId: r.issueId,
        actorKind: r.actorKind,
        actorId: r.actorId,
        actor,
        action: r.action,
        details: r.details as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
      };
    }),
  );

  return c.json(result);
});

export default app;

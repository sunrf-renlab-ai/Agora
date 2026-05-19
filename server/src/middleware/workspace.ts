import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { db } from "../db/client";
import { members } from "../db/schema/index";
import { jsonError } from "../lib/errors";

// Paths that aren't workspace-scoped. Hono leaks app.use() across sibling
// sub-apps mounted at "/", so workspaceMiddleware (registered on routers
// like provision) leaks to other routes too. Without an explicit bypass
// they 400 with "X-Workspace-ID header required".
const NO_WORKSPACE_PATHS: RegExp[] = [
  /^\/api\/cli\//,
  /^\/api\/me$/,
  /^\/api\/workspaces$/,
];

export const workspaceMiddleware = createMiddleware(async (c, next) => {
  // Hono leaks app.use() across sibling sub-apps mounted at "/". For daemon
  // endpoints (which use daemonAuthMiddleware → no user set), pass through
  // silently. Routes that genuinely need a member-scoped workspace will
  // c.get("user") later and fail with a clear error.
  const user = c.get("user") as { id: string } | undefined;
  if (!user) {
    await next();
    return;
  }

  const path = new URL(c.req.url).pathname;
  if (NO_WORKSPACE_PATHS.some((re) => re.test(path))) {
    await next();
    return;
  }

  const workspaceId = c.req.header("X-Workspace-ID") ?? c.req.param("workspaceId");
  if (!workspaceId) return jsonError(c, 400, "X-Workspace-ID header required");

  const member = await db.query.members.findFirst({
    where: and(eq(members.workspaceId, workspaceId), eq(members.userId, user.id)),
  });
  if (!member) return jsonError(c, 403, "Not a member of this workspace");

  c.set("workspaceId", workspaceId);
  c.set("memberRole", member.role as any);
  await next();
});

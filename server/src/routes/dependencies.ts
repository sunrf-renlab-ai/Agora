import { createDependencySchema } from "@agora/shared";
import { and, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { issueDependencies, issues } from "../db/schema/index";
import { jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

const depToJson = (d: typeof issueDependencies.$inferSelect) => ({
  id: d.id,
  workspaceId: d.workspaceId,
  issueId: d.issueId,
  dependsOnIssueId: d.dependsOnIssueId,
  type: d.type,
  createdByUserId: d.createdByUserId,
  createdAt: d.createdAt.toISOString(),
});

// GET /api/workspaces/:workspaceId/dependencies — flat list of every
// dependency in the workspace. Used by the Graph view to render the full
// blocks/related DAG without one round-trip per issue.
app.get("/api/workspaces/:workspaceId/dependencies", async (c) => {
  const workspaceId = c.get("workspaceId");
  const all = await db
    .select()
    .from(issueDependencies)
    .where(eq(issueDependencies.workspaceId, workspaceId));
  return c.json(all.map(depToJson));
});

// GET /api/workspaces/:workspaceId/issues/:issueId/dependencies
// Returns { blocks, blockedBy, related } — three computed views over the
// single-direction storage. blocks = rows where issue_id = current and type = 'blocks'.
// blockedBy = rows where depends_on_issue_id = current and type = 'blocks'.
// related = rows where (issue_id = current OR depends_on_issue_id = current) and type = 'related'.
app.get("/api/workspaces/:workspaceId/issues/:issueId/dependencies", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const all = await db
    .select()
    .from(issueDependencies)
    .where(
      and(
        eq(issueDependencies.workspaceId, workspaceId),
        or(eq(issueDependencies.issueId, issueId), eq(issueDependencies.dependsOnIssueId, issueId)),
      ),
    );

  const blocks = all.filter((d) => d.type === "blocks" && d.issueId === issueId);
  const blockedBy = all.filter((d) => d.type === "blocks" && d.dependsOnIssueId === issueId);
  const related = all.filter((d) => d.type === "related");

  return c.json({
    blocks: blocks.map(depToJson),
    blockedBy: blockedBy.map(depToJson),
    related: related.map(depToJson),
  });
});

// POST /api/workspaces/:workspaceId/issues/:issueId/dependencies
app.post("/api/workspaces/:workspaceId/issues/:issueId/dependencies", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const issueId = c.req.param("issueId");
  const body = await c.req.json();
  const parsed = createDependencySchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  if (parsed.data.dependsOnIssueId === issueId)
    return jsonError(c, 400, "An issue cannot depend on itself");

  // Confirm both issues live in this workspace.
  const [a, b] = await Promise.all([
    db.query.issues.findFirst({
      where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
    }),
    db.query.issues.findFirst({
      where: and(eq(issues.id, parsed.data.dependsOnIssueId), eq(issues.workspaceId, workspaceId)),
    }),
  ]);
  if (!a) return notFound(c, "Issue");
  if (!b) return notFound(c, "Target issue");

  // For 'related', store a single canonical row using sorted IDs to dedupe both directions.
  let storedIssueId = issueId;
  let storedTargetId = parsed.data.dependsOnIssueId;
  if (parsed.data.type === "related") {
    [storedIssueId, storedTargetId] = [issueId, parsed.data.dependsOnIssueId].sort() as [
      string,
      string,
    ];
  }

  try {
    const [row] = await db
      .insert(issueDependencies)
      .values({
        workspaceId,
        issueId: storedIssueId,
        dependsOnIssueId: storedTargetId,
        type: parsed.data.type,
        createdByUserId: user.id,
      })
      .returning();
    if (!row) return jsonError(c, 500, "Failed to create dependency");
    broadcastWorkspace(workspaceId, {
      type: "issue.dependencies_changed",
      data: { issueId, workspaceId },
    });
    return c.json(depToJson(row), 201);
  } catch (e) {
    if (String(e).includes("uq_dep_pair_type"))
      return jsonError(c, 409, "Dependency already exists");
    throw e;
  }
});

// DELETE /api/workspaces/:workspaceId/issues/:issueId/dependencies/:depId
app.delete("/api/workspaces/:workspaceId/issues/:issueId/dependencies/:depId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");
  const depId = c.req.param("depId");
  const [row] = await db
    .delete(issueDependencies)
    .where(and(eq(issueDependencies.id, depId), eq(issueDependencies.workspaceId, workspaceId)))
    .returning();
  if (!row) return notFound(c, "Dependency");
  broadcastWorkspace(workspaceId, {
    type: "issue.dependencies_changed",
    data: { issueId, workspaceId },
  });
  return c.body(null, 204);
});

export default app;

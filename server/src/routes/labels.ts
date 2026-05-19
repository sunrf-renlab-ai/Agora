import { createLabelSchema, updateLabelSchema } from "@agora/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import { issueLabels, issueToLabel, issues } from "../db/schema/index";
import { jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

const labelToJson = (l: typeof issueLabels.$inferSelect) => ({
  id: l.id,
  workspaceId: l.workspaceId,
  name: l.name,
  color: l.color,
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
});

// PUT body: { labelIds: string[] } — replaces all label bindings on an issue
const replaceLabelsSchema = z.object({
  labelIds: z.array(z.string().uuid()),
});

// GET /api/workspaces/:workspaceId/labels — list workspace labels
app.get("/api/workspaces/:workspaceId/labels", async (c) => {
  const workspaceId = c.get("workspaceId");
  const rows = await db.query.issueLabels.findMany({
    where: eq(issueLabels.workspaceId, workspaceId),
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  return c.json(rows.map(labelToJson));
});

// POST /api/workspaces/:workspaceId/labels — create label
app.post("/api/workspaces/:workspaceId/labels", async (c) => {
  const workspaceId = c.get("workspaceId");
  const body = await c.req.json();
  const parsed = createLabelSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  try {
    const [row] = await db
      .insert(issueLabels)
      .values({
        workspaceId,
        name: parsed.data.name,
        color: parsed.data.color.toLowerCase(),
      })
      .returning();
    if (!row) return jsonError(c, 500, "Failed to create label");
    broadcastWorkspace(workspaceId, {
      type: "label.created",
      data: { id: row.id, workspaceId },
    });
    return c.json(labelToJson(row), 201);
  } catch (e) {
    if (String(e).includes("uq_label_workspace_name")) {
      return jsonError(c, 409, "Label name already exists");
    }
    throw e;
  }
});

// PATCH /api/workspaces/:workspaceId/labels/:labelId — update label
app.patch("/api/workspaces/:workspaceId/labels/:labelId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const labelId = c.req.param("labelId");
  const body = await c.req.json();
  const parsed = updateLabelSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.color !== undefined) update.color = parsed.data.color.toLowerCase();

  try {
    const [row] = await db
      .update(issueLabels)
      .set(update)
      .where(and(eq(issueLabels.id, labelId), eq(issueLabels.workspaceId, workspaceId)))
      .returning();
    if (!row) return notFound(c, "Label");
    broadcastWorkspace(workspaceId, {
      type: "label.updated",
      data: { id: row.id, workspaceId },
    });
    return c.json(labelToJson(row));
  } catch (e) {
    if (String(e).includes("uq_label_workspace_name")) {
      return jsonError(c, 409, "Label name already exists");
    }
    throw e;
  }
});

// DELETE /api/workspaces/:workspaceId/labels/:labelId — delete label
app.delete("/api/workspaces/:workspaceId/labels/:labelId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const labelId = c.req.param("labelId");
  // Cascade-clean assignments first
  await db.delete(issueToLabel).where(eq(issueToLabel.labelId, labelId));
  const [row] = await db
    .delete(issueLabels)
    .where(and(eq(issueLabels.id, labelId), eq(issueLabels.workspaceId, workspaceId)))
    .returning();
  if (!row) return notFound(c, "Label");
  broadcastWorkspace(workspaceId, {
    type: "label.deleted",
    data: { id: labelId, workspaceId },
  });
  return c.body(null, 204);
});

// PUT /api/workspaces/:workspaceId/issues/:issueId/labels — replace bindings
app.put("/api/workspaces/:workspaceId/issues/:issueId/labels", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");
  const body = await c.req.json();
  const parsed = replaceLabelsSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const requested = Array.from(new Set(parsed.data.labelIds));
  if (requested.length > 0) {
    const valid = await db
      .select({ id: issueLabels.id })
      .from(issueLabels)
      .where(and(eq(issueLabels.workspaceId, workspaceId), inArray(issueLabels.id, requested)));
    if (valid.length !== requested.length) return notFound(c, "Label");
  }

  // Replace: clear existing bindings then re-insert.
  await db.delete(issueToLabel).where(eq(issueToLabel.issueId, issueId));
  if (requested.length > 0) {
    await db
      .insert(issueToLabel)
      .values(requested.map((labelId) => ({ issueId, labelId, workspaceId })))
      .onConflictDoNothing();
  }

  broadcastWorkspace(workspaceId, {
    type: "issue.labels_changed",
    data: { issueId, workspaceId },
  });
  return c.body(null, 204);
});

export default app;

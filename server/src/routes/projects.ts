import { addProjectResourceSchema, createProjectSchema, updateProjectSchema } from "@agora/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { projectResources, projects } from "../db/schema/index";
import { jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

const projectToJson = (p: typeof projects.$inferSelect) => ({
  id: p.id,
  workspaceId: p.workspaceId,
  title: p.title,
  description: p.description,
  icon: p.icon,
  color: p.color,
  status: p.status,
  priority: p.priority,
  leadType: p.leadType,
  leadId: p.leadId,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

const resourceToJson = (r: typeof projectResources.$inferSelect) => ({
  id: r.id,
  projectId: r.projectId,
  workspaceId: r.workspaceId,
  resourceType: r.resourceType,
  resourceRef: r.resourceRef,
  label: r.label,
  position: r.position,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
});

app.get("/api/workspaces/:workspaceId/projects", async (c) => {
  const workspaceId = c.get("workspaceId");
  const rows = await db.query.projects.findMany({
    where: eq(projects.workspaceId, workspaceId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
  return c.json(rows.map(projectToJson));
});

app.post("/api/workspaces/:workspaceId/projects", async (c) => {
  const workspaceId = c.get("workspaceId");
  const body = await c.req.json();
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const [row] = await db
    .insert(projects)
    .values({
      workspaceId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      icon: parsed.data.icon ?? null,
      color: parsed.data.color ?? null,
      status: parsed.data.status ?? "active",
      priority: parsed.data.priority ?? "none",
      leadType: parsed.data.leadType ?? null,
      leadId: parsed.data.leadId ?? null,
    })
    .returning();
  if (!row) return jsonError(c, 500, "Failed to create project");
  broadcastWorkspace(workspaceId, { type: "project.created", data: { id: row.id, workspaceId } });
  return c.json(projectToJson(row), 201);
});

app.get("/api/workspaces/:workspaceId/projects/:projectId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const projectId = c.req.param("projectId");
  const p = await db.query.projects.findFirst({
    where: and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)),
  });
  if (!p) return notFound(c, "Project");
  const resources = await db
    .select()
    .from(projectResources)
    .where(eq(projectResources.projectId, p.id))
    .orderBy(projectResources.position, projectResources.createdAt);
  return c.json({ ...projectToJson(p), resources: resources.map(resourceToJson) });
});

app.patch("/api/workspaces/:workspaceId/projects/:projectId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const parsed = updateProjectSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const [row] = await db
    .update(projects)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
    .returning();
  if (!row) return notFound(c, "Project");
  broadcastWorkspace(workspaceId, { type: "project.updated", data: { id: row.id, workspaceId } });
  return c.json(projectToJson(row));
});

app.delete("/api/workspaces/:workspaceId/projects/:projectId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const projectId = c.req.param("projectId");
  const [row] = await db
    .delete(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
    .returning();
  if (!row) return notFound(c, "Project");
  broadcastWorkspace(workspaceId, {
    type: "project.deleted",
    data: { id: projectId, workspaceId },
  });
  return c.body(null, 204);
});

app.post("/api/workspaces/:workspaceId/projects/:projectId/resources", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const projectId = c.req.param("projectId");
  const proj = await db.query.projects.findFirst({
    where: and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)),
  });
  if (!proj) return notFound(c, "Project");
  const body = await c.req.json();
  const parsed = addProjectResourceSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  try {
    const [row] = await db
      .insert(projectResources)
      .values({
        projectId,
        workspaceId,
        createdBy: user.id,
        resourceType: parsed.data.resourceType,
        resourceRef: parsed.data.resourceRef,
        label: parsed.data.label ?? null,
        position: parsed.data.position ?? 0,
      })
      .returning();
    if (!row) return jsonError(c, 500, "Failed to add resource");
    broadcastWorkspace(workspaceId, {
      type: "project.updated",
      data: { id: projectId, workspaceId },
    });
    return c.json(resourceToJson(row), 201);
  } catch (e) {
    const cause = (e as { cause?: { constraint_name?: string; message?: string } }).cause;
    const blob = `${String(e)} ${cause?.message ?? ""} ${cause?.constraint_name ?? ""}`;
    if (blob.includes("uq_project_resource_ref")) {
      return jsonError(c, 409, "resource already linked");
    }
    throw e;
  }
});

app.delete("/api/workspaces/:workspaceId/projects/:projectId/resources/:resourceId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const [row] = await db
    .delete(projectResources)
    .where(
      and(
        eq(projectResources.workspaceId, workspaceId),
        eq(projectResources.id, c.req.param("resourceId")),
        eq(projectResources.projectId, c.req.param("projectId")),
      ),
    )
    .returning();
  if (!row) return notFound(c, "Resource");
  broadcastWorkspace(workspaceId, {
    type: "project.updated",
    data: { id: row.projectId, workspaceId },
  });
  return c.body(null, 204);
});

export default app;

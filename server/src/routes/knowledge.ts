import { createKnowledgeDocSchema, updateKnowledgeDocSchema } from "@agora/shared";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { workspaceKnowledgeDocs } from "../db/schema/index";
import { jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

const docToJson = (d: typeof workspaceKnowledgeDocs.$inferSelect) => ({
  id: d.id,
  workspaceId: d.workspaceId,
  projectId: d.projectId,
  kind: d.kind,
  title: d.title,
  content: d.content,
  createdBy: d.createdBy,
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});

app.get("/api/workspaces/:workspaceId/knowledge", async (c) => {
  const workspaceId = c.get("workspaceId");
  // ?projectId filter:
  //   absent           → all docs (workspace + every project)
  //   ?projectId=ws    → workspace-wide only (NULL project_id)
  //   ?projectId=<id>  → docs for that project + workspace-wide
  //                      (project page wants both — workspace-wide
  //                      docs are inherited by every project view)
  const projectId = c.req.query("projectId");
  let where = eq(workspaceKnowledgeDocs.workspaceId, workspaceId);
  if (projectId === "ws") {
    where = and(where, isNull(workspaceKnowledgeDocs.projectId)) as typeof where;
  } else if (projectId) {
    where = and(
      where,
      or(
        isNull(workspaceKnowledgeDocs.projectId),
        eq(workspaceKnowledgeDocs.projectId, projectId),
      ),
    ) as typeof where;
  }
  const rows = await db.query.workspaceKnowledgeDocs.findMany({
    where,
    orderBy: (t) => [desc(t.updatedAt)],
  });
  return c.json(rows.map(docToJson));
});

app.post("/api/workspaces/:workspaceId/knowledge", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const parsed = createKnowledgeDocSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const [d] = await db
    .insert(workspaceKnowledgeDocs)
    .values({
      workspaceId,
      projectId: parsed.data.projectId ?? null,
      createdBy: user.id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      content: parsed.data.content,
    })
    .returning();
  if (!d) return jsonError(c, 500, "failed to create");
  broadcastWorkspace(workspaceId, { type: "knowledge.created", data: { id: d.id } });
  return c.json(docToJson(d), 201);
});

app.get("/api/workspaces/:workspaceId/knowledge/:docId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const docId = c.req.param("docId");
  const d = await db.query.workspaceKnowledgeDocs.findFirst({
    where: and(eq(workspaceKnowledgeDocs.id, docId), eq(workspaceKnowledgeDocs.workspaceId, workspaceId)),
  });
  if (!d) return notFound(c, "Knowledge doc");
  return c.json(docToJson(d));
});

app.patch("/api/workspaces/:workspaceId/knowledge/:docId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const docId = c.req.param("docId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateKnowledgeDocSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const [d] = await db
    .update(workspaceKnowledgeDocs)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(
      and(eq(workspaceKnowledgeDocs.id, docId), eq(workspaceKnowledgeDocs.workspaceId, workspaceId)),
    )
    .returning();
  if (!d) return notFound(c, "Knowledge doc");
  broadcastWorkspace(workspaceId, { type: "knowledge.updated", data: { id: d.id } });
  return c.json(docToJson(d));
});

app.delete("/api/workspaces/:workspaceId/knowledge/:docId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const docId = c.req.param("docId");
  const [d] = await db
    .delete(workspaceKnowledgeDocs)
    .where(
      and(eq(workspaceKnowledgeDocs.id, docId), eq(workspaceKnowledgeDocs.workspaceId, workspaceId)),
    )
    .returning();
  if (!d) return notFound(c, "Knowledge doc");
  broadcastWorkspace(workspaceId, { type: "knowledge.deleted", data: { id: d.id } });
  return c.body(null, 204);
});

export default app;

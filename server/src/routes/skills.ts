import { createSkillSchema, importSkillUrlSchema, updateSkillSchema } from "@agora/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import { skills } from "../db/schema/index";
import { forbidden, jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";
import {
  createSkillWithFiles,
  deleteSkillFile,
  listSkillFiles,
  loadSkillWithFiles,
  replaceSkillFiles,
  upsertSkillFile,
} from "../services/skill";
import { fetchImportedSkill } from "../services/skill-import";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

const skillToJson = (s: typeof skills.$inferSelect) => ({
  id: s.id,
  workspaceId: s.workspaceId,
  ownerId: s.ownerId,
  name: s.name,
  description: s.description,
  content: s.content,
  config: s.config as Record<string, unknown>,
  visibility: s.visibility,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

app.get("/api/workspaces/:workspaceId/skills", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const visibilityFilter = c.req.query("visibility");
  const rows = await db.query.skills.findMany({
    where: (t, { and: a, eq: e, or }) => {
      const baseWs = e(t.workspaceId, workspaceId);
      // Hide other users' private skills
      const visible = or(e(t.visibility, "workspace"), e(t.ownerId, user.id));
      if (visibilityFilter === "workspace" || visibilityFilter === "private") {
        return a(baseWs, e(t.visibility, visibilityFilter), visible);
      }
      return a(baseWs, visible);
    },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  return c.json(rows.map(skillToJson));
});

app.get("/api/workspaces/:workspaceId/skills/:skillId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const out = await loadSkillWithFiles(c.req.param("skillId"), workspaceId);
  if (!out) return notFound(c, "Skill");
  if (out.visibility === "private" && out.ownerId !== user.id) return notFound(c, "Skill");
  return c.json(out);
});

app.post("/api/workspaces/:workspaceId/skills", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = createSkillSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  try {
    const out = await createSkillWithFiles({
      workspaceId,
      ownerId: user.id,
      name: parsed.data.name,
      description: parsed.data.description,
      content: parsed.data.content,
      config: parsed.data.config,
      visibility: parsed.data.visibility ?? "workspace",
      files: parsed.data.files,
    });
    broadcastWorkspace(workspaceId, { type: "skill.created", data: { id: out.id, workspaceId } });
    return c.json(out, 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("already exists")) return jsonError(c, 409, msg);
    if (msg.includes("invalid file path")) return jsonError(c, 400, msg);
    throw e;
  }
});

app.post("/api/workspaces/:workspaceId/skills/import", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = importSkillUrlSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  let imported: Awaited<ReturnType<typeof fetchImportedSkill>>;
  try {
    imported = await fetchImportedSkill(parsed.data.url);
  } catch (e) {
    return jsonError(c, 502, (e as Error).message);
  }
  try {
    const out = await createSkillWithFiles({
      workspaceId,
      ownerId: user.id,
      name: imported.name,
      description: imported.description,
      content: imported.content,
      config: { origin: { type: "url", url: parsed.data.url } },
      visibility: "workspace",
      files: imported.files.filter(
        (f) => f.path && !f.path.startsWith("/") && !f.path.includes(".."),
      ),
    });
    broadcastWorkspace(workspaceId, { type: "skill.created", data: { id: out.id, workspaceId } });
    return c.json(out, 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("already exists")) return jsonError(c, 409, msg);
    throw e;
  }
});

app.patch("/api/workspaces/:workspaceId/skills/:skillId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const skillId = c.req.param("skillId");
  const existing = await db.query.skills.findFirst({
    where: and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)),
  });
  if (!existing) return notFound(c, "Skill");
  if (existing.ownerId !== user.id && role === "member") return forbidden(c);
  const body = await c.req.json();
  const parsed = updateSkillSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const patch: Partial<typeof skills.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.content !== undefined) patch.content = parsed.data.content;
  if (parsed.data.config !== undefined) patch.config = parsed.data.config;
  if (parsed.data.visibility !== undefined) patch.visibility = parsed.data.visibility;
  try {
    await db.update(skills).set(patch).where(eq(skills.id, skillId));
  } catch (e) {
    const cause = (e as { cause?: { constraint_name?: string; message?: string } }).cause;
    const blob = `${String(e)} ${cause?.message ?? ""} ${cause?.constraint_name ?? ""}`;
    if (blob.includes("uq_skill_workspace_name")) {
      return jsonError(c, 409, "a skill with this name already exists");
    }
    throw e;
  }
  if (parsed.data.files !== undefined) {
    try {
      await replaceSkillFiles(skillId, parsed.data.files);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("invalid file path")) return jsonError(c, 400, msg);
      throw e;
    }
  }
  const out = await loadSkillWithFiles(skillId, workspaceId);
  broadcastWorkspace(workspaceId, { type: "skill.updated", data: { id: skillId, workspaceId } });
  return c.json(out);
});

// ---------------------------------------------------------------------------
// Skill files (sub-resource)
// ---------------------------------------------------------------------------

// List files for a skill. Visible to anyone who can see the skill.
app.get("/api/workspaces/:workspaceId/skills/:skillId/files", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const skillId = c.req.param("skillId");
  const skill = await db.query.skills.findFirst({
    where: and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)),
  });
  if (!skill) return notFound(c, "Skill");
  if (skill.visibility === "private" && skill.ownerId !== user.id) return notFound(c, "Skill");
  const files = await listSkillFiles(skillId);
  return c.json(files);
});

// Upsert a file by path (natural key).
const upsertSkillFileSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(1_000_000).default(""),
});

// POST (not PUT) because this is a collection endpoint with natural-key
// upsert semantics: the body's `path` identifies the row to create-or-replace.
// PUT-on-collection is widely understood as "replace the whole list", which
// this handler emphatically doesn't do. POST is the conventional verb for
// "submit a new resource to this collection" and tolerates server-side
// dedup on a natural key.
app.post("/api/workspaces/:workspaceId/skills/:skillId/files", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const skillId = c.req.param("skillId");
  const skill = await db.query.skills.findFirst({
    where: and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)),
  });
  if (!skill) return notFound(c, "Skill");
  if (skill.ownerId !== user.id && role === "member") return forbidden(c);
  const body = await c.req.json();
  const parsed = upsertSkillFileSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  try {
    const file = await upsertSkillFile(skillId, parsed.data.path, parsed.data.content);
    broadcastWorkspace(workspaceId, {
      type: "skill.updated",
      data: { id: skillId, workspaceId },
    });
    return c.json(file);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("invalid file path")) return jsonError(c, 400, msg);
    throw e;
  }
});

app.delete("/api/workspaces/:workspaceId/skills/:skillId/files/:fileId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const skillId = c.req.param("skillId");
  const fileId = c.req.param("fileId");
  const skill = await db.query.skills.findFirst({
    where: and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)),
  });
  if (!skill) return notFound(c, "Skill");
  if (skill.ownerId !== user.id && role === "member") return forbidden(c);
  const ok = await deleteSkillFile(skillId, fileId);
  if (!ok) return notFound(c, "Skill file");
  broadcastWorkspace(workspaceId, { type: "skill.updated", data: { id: skillId, workspaceId } });
  return c.body(null, 204);
});

app.delete("/api/workspaces/:workspaceId/skills/:skillId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const skillId = c.req.param("skillId");
  const existing = await db.query.skills.findFirst({
    where: and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)),
  });
  if (!existing) return notFound(c, "Skill");
  if (existing.ownerId !== user.id && role === "member") return forbidden(c);
  await db.delete(skills).where(eq(skills.id, skillId));
  broadcastWorkspace(workspaceId, { type: "skill.deleted", data: { id: skillId, workspaceId } });
  return c.body(null, 204);
});

export default app;

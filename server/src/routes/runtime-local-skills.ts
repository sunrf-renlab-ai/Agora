import { createLocalSkillImportSchema } from "@agora/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import {
  runtimeLocalSkillImportRequests,
  runtimeLocalSkillListRequests,
  runtimes,
} from "../db/schema/index";
import { daemonHub } from "../lib/daemon-hub";
import { jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { daemonAuthMiddleware } from "../middleware/daemon-auth";
import { workspaceMiddleware } from "../middleware/workspace";
import { createSkillWithFiles } from "../services/skill";

// ---------- JSON serializers ----------

function listToJson(r: typeof runtimeLocalSkillListRequests.$inferSelect) {
  return {
    id: r.id,
    runtimeId: r.runtimeId,
    creatorId: r.creatorId,
    status: r.status,
    skills: r.skills,
    supported: r.supported,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  };
}

function importToJson(r: typeof runtimeLocalSkillImportRequests.$inferSelect) {
  return {
    id: r.id,
    runtimeId: r.runtimeId,
    creatorId: r.creatorId,
    skillKey: r.skillKey,
    skillId: r.skillId,
    status: r.status,
    name: r.name,
    description: r.description,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  };
}

// ---------- Auth + workspace routes ----------

const app = new Hono();

const userApp = new Hono();
userApp.use("/api/workspaces/:workspaceId/runtimes/:runtimeId/local-skills/*", authMiddleware);
userApp.use("/api/workspaces/:workspaceId/runtimes/:runtimeId/local-skills/*", workspaceMiddleware);

// POST /api/workspaces/:workspaceId/runtimes/:runtimeId/local-skills/list
userApp.post("/api/workspaces/:workspaceId/runtimes/:runtimeId/local-skills/list", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const runtimeId = c.req.param("runtimeId");

  const runtime = await db.query.runtimes.findFirst({
    where: and(eq(runtimes.id, runtimeId), eq(runtimes.workspaceId, workspaceId)),
  });
  if (!runtime) return notFound(c, "Runtime");

  const [row] = await db
    .insert(runtimeLocalSkillListRequests)
    .values({ runtimeId, creatorId: user.id, status: "pending" })
    .returning();
  if (!row) return jsonError(c, 500, "Failed to create list request");

  daemonHub.notifySkillDiscover(runtimeId, row.id, "list");
  return c.json({ requestId: row.id }, 201);
});

// GET /api/workspaces/:workspaceId/runtimes/:runtimeId/local-skills/list/:requestId
userApp.get(
  "/api/workspaces/:workspaceId/runtimes/:runtimeId/local-skills/list/:requestId",
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const runtimeId = c.req.param("runtimeId");
    const requestId = c.req.param("requestId");

    const runtime = await db.query.runtimes.findFirst({
      where: and(eq(runtimes.id, runtimeId), eq(runtimes.workspaceId, workspaceId)),
    });
    if (!runtime) return notFound(c, "Runtime");

    const row = await db.query.runtimeLocalSkillListRequests.findFirst({
      where: and(
        eq(runtimeLocalSkillListRequests.id, requestId),
        eq(runtimeLocalSkillListRequests.runtimeId, runtimeId),
      ),
    });
    if (!row) return notFound(c, "List request");
    return c.json(listToJson(row));
  },
);

// POST /api/workspaces/:workspaceId/runtimes/:runtimeId/local-skills/import
userApp.post("/api/workspaces/:workspaceId/runtimes/:runtimeId/local-skills/import", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const runtimeId = c.req.param("runtimeId");

  const runtime = await db.query.runtimes.findFirst({
    where: and(eq(runtimes.id, runtimeId), eq(runtimes.workspaceId, workspaceId)),
  });
  if (!runtime) return notFound(c, "Runtime");

  const body = await c.req.json().catch(() => ({}));
  const parsed = createLocalSkillImportSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const [row] = await db
    .insert(runtimeLocalSkillImportRequests)
    .values({
      runtimeId,
      creatorId: user.id,
      skillKey: parsed.data.skillKey,
      name: parsed.data.name ?? "",
      description: parsed.data.description ?? "",
      visibility: parsed.data.visibility ?? "workspace",
      status: "pending",
    })
    .returning();
  if (!row) return jsonError(c, 500, "Failed to create import request");

  daemonHub.notifySkillDiscover(runtimeId, row.id, "import", parsed.data.skillKey);
  return c.json({ requestId: row.id }, 201);
});

// GET /api/workspaces/:workspaceId/runtimes/:runtimeId/local-skills/import/:requestId
userApp.get(
  "/api/workspaces/:workspaceId/runtimes/:runtimeId/local-skills/import/:requestId",
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const runtimeId = c.req.param("runtimeId");
    const requestId = c.req.param("requestId");

    const runtime = await db.query.runtimes.findFirst({
      where: and(eq(runtimes.id, runtimeId), eq(runtimes.workspaceId, workspaceId)),
    });
    if (!runtime) return notFound(c, "Runtime");

    const row = await db.query.runtimeLocalSkillImportRequests.findFirst({
      where: and(
        eq(runtimeLocalSkillImportRequests.id, requestId),
        eq(runtimeLocalSkillImportRequests.runtimeId, runtimeId),
      ),
    });
    if (!row) return notFound(c, "Import request");
    return c.json(importToJson(row));
  },
);

app.route("/", userApp);

// ---------- Daemon callback routes ----------

const dApp = new Hono();
dApp.use("/api/daemon/*", daemonAuthMiddleware);

const localSkillSummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().default(""),
  sourcePath: z.string().default(""),
  provider: z.string().default(""),
  fileCount: z.number().int().nonnegative().default(0),
});

const listCallbackSchema = z.object({
  skills: z.array(localSkillSummarySchema).optional(),
  supported: z.boolean().optional(),
  error: z.string().optional(),
});

const importFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const importCallbackSchema = z.object({
  skill: z
    .object({
      name: z.string().min(1),
      description: z.string().default(""),
      content: z.string().default(""),
      files: z.array(importFileSchema).max(256).default([]),
    })
    .optional(),
  error: z.string().optional(),
});

// POST /api/daemon/runtimes/:runtimeId/local-skills/list/:requestId
dApp.post("/api/daemon/runtimes/:runtimeId/local-skills/list/:requestId", async (c) => {
  const runtime = c.get("runtime");
  const runtimeIdParam = c.req.param("runtimeId");
  if (runtimeIdParam !== runtime.id) return jsonError(c, 403, "runtime mismatch");
  const requestId = c.req.param("requestId");

  const body = await c.req.json().catch(() => ({}));
  const parsed = listCallbackSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const errMsg = parsed.data.error?.trim() ?? "";
  const isFailure = errMsg.length > 0;

  const patch: Partial<typeof runtimeLocalSkillListRequests.$inferInsert> = isFailure
    ? { status: "failed", error: errMsg, skills: [], supported: parsed.data.supported ?? true }
    : {
        status: "completed",
        skills: parsed.data.skills ?? [],
        supported: parsed.data.supported ?? true,
        error: "",
      };

  const [updated] = await db
    .update(runtimeLocalSkillListRequests)
    .set(patch)
    .where(
      and(
        eq(runtimeLocalSkillListRequests.id, requestId),
        eq(runtimeLocalSkillListRequests.runtimeId, runtime.id),
      ),
    )
    .returning();
  if (!updated) return notFound(c, "List request");

  broadcastWorkspace(runtime.workspaceId, {
    type: "runtime.local_skills.list_updated",
    data: { runtimeId: runtime.id, requestId: updated.id, status: updated.status },
  });

  return c.json(listToJson(updated));
});

// POST /api/daemon/runtimes/:runtimeId/local-skills/import/:requestId
dApp.post("/api/daemon/runtimes/:runtimeId/local-skills/import/:requestId", async (c) => {
  const runtime = c.get("runtime");
  const runtimeIdParam = c.req.param("runtimeId");
  if (runtimeIdParam !== runtime.id) return jsonError(c, 403, "runtime mismatch");
  const requestId = c.req.param("requestId");

  const body = await c.req.json().catch(() => ({}));
  const parsed = importCallbackSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const existing = await db.query.runtimeLocalSkillImportRequests.findFirst({
    where: and(
      eq(runtimeLocalSkillImportRequests.id, requestId),
      eq(runtimeLocalSkillImportRequests.runtimeId, runtime.id),
    ),
  });
  if (!existing) return notFound(c, "Import request");

  const errMsg = parsed.data.error?.trim() ?? "";
  const isFailure = errMsg.length > 0 || !parsed.data.skill;

  if (isFailure) {
    const [updated] = await db
      .update(runtimeLocalSkillImportRequests)
      .set({ status: "failed", error: errMsg || "no skill payload returned" })
      .where(eq(runtimeLocalSkillImportRequests.id, requestId))
      .returning();
    if (!updated) return notFound(c, "Import request");
    broadcastWorkspace(runtime.workspaceId, {
      type: "runtime.local_skills.import_updated",
      data: { runtimeId: runtime.id, requestId: updated.id, status: updated.status },
    });
    return c.json(importToJson(updated));
  }

  const skillPayload = parsed.data.skill;
  if (!skillPayload) {
    // unreachable — guarded above — but keeps the type narrow.
    return jsonError(c, 400, "skill payload missing");
  }
  const desiredName = (existing.name?.trim() || skillPayload.name).slice(0, 200);
  const desiredDescription = existing.description?.trim() || skillPayload.description;

  try {
    const skill = await createSkillWithFiles({
      workspaceId: runtime.workspaceId,
      ownerId: existing.creatorId,
      name: desiredName,
      description: desiredDescription,
      content: skillPayload.content,
      config: {},
      // Apply the visibility the user chose at promote-time. Falls back
      // to "workspace" if the column is empty (old request rows from
      // before the migration).
      visibility: existing.visibility ?? "workspace",
      files: skillPayload.files,
    });
    const [updated] = await db
      .update(runtimeLocalSkillImportRequests)
      .set({
        status: "completed",
        skillId: skill.id,
        name: desiredName,
        description: desiredDescription,
        error: "",
      })
      .where(eq(runtimeLocalSkillImportRequests.id, requestId))
      .returning();
    if (!updated) return notFound(c, "Import request");
    broadcastWorkspace(runtime.workspaceId, {
      type: "skill.created",
      data: { id: skill.id, workspaceId: runtime.workspaceId },
    });
    broadcastWorkspace(runtime.workspaceId, {
      type: "runtime.local_skills.import_updated",
      data: { runtimeId: runtime.id, requestId: updated.id, status: updated.status },
    });
    return c.json(importToJson(updated));
  } catch (e) {
    const msg = (e as Error).message;
    const [updated] = await db
      .update(runtimeLocalSkillImportRequests)
      .set({ status: "failed", error: msg })
      .where(eq(runtimeLocalSkillImportRequests.id, requestId))
      .returning();
    if (!updated) return notFound(c, "Import request");
    broadcastWorkspace(runtime.workspaceId, {
      type: "runtime.local_skills.import_updated",
      data: { runtimeId: runtime.id, requestId: updated.id, status: updated.status },
    });
    return c.json(importToJson(updated));
  }
});

app.route("/", dApp);

export default app;

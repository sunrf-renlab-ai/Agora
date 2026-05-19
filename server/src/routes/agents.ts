import { createAgentSchema, setAgentSkillsSchema, updateAgentSchema } from "@agora/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { agentSkills, agentTaskQueue, agents, skills } from "../db/schema/index";
import { forbidden, jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";
import { broadcastSkillSyncForAgent } from "../services/skill-sync";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

function agentToJson(a: typeof agents.$inferSelect) {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    ownerId: a.ownerId,
    name: a.name,
    description: a.description,
    instructions: a.instructions,
    avatarUrl: a.avatarUrl,
    visibility: a.visibility,
    runtimeId: a.runtimeId,
    cliKind: a.cliKind,
    runtimeConfig: a.runtimeConfig,
    model: a.model,
    customEnv: a.customEnv,
    customArgs: a.customArgs,
    mcpConfig: a.mcpConfig,
    maxConcurrentTasks: a.maxConcurrentTasks,
    archivedAt: a.archivedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

app.get("/api/workspaces/:workspaceId/agents", async (c) => {
  const workspaceId = c.get("workspaceId");
  const includeArchived = c.req.query("archived") === "true";
  const conditions = [eq(agents.workspaceId, workspaceId)];
  if (!includeArchived) conditions.push(isNull(agents.archivedAt));
  const rows = await db.query.agents.findMany({
    where: and(...conditions),
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  return c.json(rows.map(agentToJson));
});

app.post("/api/workspaces/:workspaceId/agents", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const [a] = await db
    .insert(agents)
    .values({
      workspaceId,
      ownerId: user.id,
      ...parsed.data,
    })
    .returning();
  if (!a) return jsonError(c, 500, "Failed to create agent");
  broadcastWorkspace(workspaceId, { type: "agent.created", data: { id: a.id, workspaceId } });
  return c.json(agentToJson(a), 201);
});

app.get("/api/workspaces/:workspaceId/agents/:agentId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const agentId = c.req.param("agentId");
  const a = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)),
  });
  if (!a) return notFound(c, "Agent");
  return c.json(agentToJson(a));
});

app.patch("/api/workspaces/:workspaceId/agents/:agentId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const role = c.get("memberRole");
  const user = c.get("user");
  const agentId = c.req.param("agentId");
  const existing = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)),
  });
  if (!existing) return notFound(c, "Agent");
  if (existing.ownerId !== user.id && role === "member") return forbidden(c);
  const body = await c.req.json();
  const parsed = updateAgentSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const [a] = await db
    .update(agents)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(agents.id, agentId))
    .returning();
  if (!a) return notFound(c, "Agent");
  broadcastWorkspace(workspaceId, { type: "agent.updated", data: { id: a.id, workspaceId } });
  return c.json(agentToJson(a));
});

app.post("/api/workspaces/:workspaceId/agents/:agentId/archive", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const agentId = c.req.param("agentId");
  const [a] = await db
    .update(agents)
    .set({ archivedAt: new Date(), archivedBy: user.id, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .returning();
  if (!a) return notFound(c, "Agent");
  await db
    .update(agentTaskQueue)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(agentTaskQueue.agentId, agentId),
        inArray(agentTaskQueue.status, ["queued", "dispatched", "running"]),
      ),
    );
  broadcastWorkspace(workspaceId, { type: "agent.archived", data: { id: a.id, workspaceId } });
  return c.json(agentToJson(a));
});

app.post("/api/workspaces/:workspaceId/agents/:agentId/restore", async (c) => {
  const workspaceId = c.get("workspaceId");
  const agentId = c.req.param("agentId");
  const [a] = await db
    .update(agents)
    .set({ archivedAt: null, archivedBy: null, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .returning();
  if (!a) return notFound(c, "Agent");
  broadcastWorkspace(workspaceId, { type: "agent.updated", data: { id: a.id, workspaceId } });
  return c.json(agentToJson(a));
});

app.get("/api/workspaces/:workspaceId/agents/:agentId/tasks", async (c) => {
  const workspaceId = c.get("workspaceId");
  const agentId = c.req.param("agentId");
  const rows = await db.query.agentTaskQueue.findMany({
    where: and(eq(agentTaskQueue.agentId, agentId), eq(agentTaskQueue.workspaceId, workspaceId)),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 100,
  });
  return c.json(rows);
});

function skillRowToJson(s: typeof skills.$inferSelect) {
  return {
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
  };
}

app.get("/api/workspaces/:workspaceId/agents/:agentId/skills", async (c) => {
  const workspaceId = c.get("workspaceId");
  const agentId = c.req.param("agentId");
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)),
  });
  if (!agent) return notFound(c, "Agent");
  const rows = await db
    .select({ skill: skills })
    .from(agentSkills)
    .innerJoin(skills, eq(agentSkills.skillId, skills.id))
    .where(eq(agentSkills.agentId, agentId));
  return c.json(rows.map((r) => skillRowToJson(r.skill)));
});

app.put("/api/workspaces/:workspaceId/agents/:agentId/skills", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const agentId = c.req.param("agentId");
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)),
  });
  if (!agent) return notFound(c, "Agent");
  if (agent.ownerId !== user.id && role === "member") return forbidden(c);

  const body = await c.req.json();
  const parsed = setAgentSkillsSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const requested = Array.from(new Set(parsed.data.skillIds));
  if (requested.length > 0) {
    const allowed = await db
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.workspaceId, workspaceId), inArray(skills.id, requested)));
    const allowedSet = new Set(allowed.map((s) => s.id));
    for (const id of requested) {
      if (!allowedSet.has(id)) return jsonError(c, 400, `skill ${id} not in workspace`);
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
    if (requested.length > 0) {
      await tx.insert(agentSkills).values(requested.map((id) => ({ agentId, skillId: id })));
    }
  });

  await broadcastSkillSyncForAgent(agentId);
  broadcastWorkspace(workspaceId, {
    type: "agent.skills_changed",
    data: { agentId, workspaceId },
  });

  const final = await db
    .select({ skill: skills })
    .from(agentSkills)
    .innerJoin(skills, eq(agentSkills.skillId, skills.id))
    .where(eq(agentSkills.agentId, agentId));
  return c.json(final.map((r) => skillRowToJson(r.skill)));
});

export default app;

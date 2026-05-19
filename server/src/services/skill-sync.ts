import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { agentSkills, agents, skillFiles, skills } from "../db/schema/index";
import { daemonHub } from "../lib/daemon-hub";

interface Bundle {
  skillId: string;
  name: string;
  description: string;
  content: string;
  files: { path: string; content: string }[];
}

export async function bundlesForAgent(agentId: string): Promise<Bundle[]> {
  // Three sources, in order of precedence (later wins on dedup-by-id so
  // explicit bindings can override any future per-binding config):
  //   1. Public skills from ANY workspace (visibility = "public")
  //   2. Workspace-scoped skills from the agent's own workspace
  //      (visibility = "workspace"). This is what makes
  //      task-sedimented skills automatically visible to every agent
  //      in the same workspace without anyone manually binding them.
  //   3. Skills explicitly bound to this agent via agent_skill — these
  //      win on collision so a deliberate binding always trumps the
  //      ambient workspace/public sets.
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent) return [];

  const boundRows = await db
    .select({
      id: skills.id,
      name: skills.name,
      description: skills.description,
      content: skills.content,
    })
    .from(agentSkills)
    .innerJoin(skills, eq(agentSkills.skillId, skills.id))
    .where(eq(agentSkills.agentId, agentId));

  const workspaceRows = await db
    .select({
      id: skills.id,
      name: skills.name,
      description: skills.description,
      content: skills.content,
    })
    .from(skills)
    .where(and(eq(skills.workspaceId, agent.workspaceId), eq(skills.visibility, "workspace")));

  const publicRows = await db
    .select({
      id: skills.id,
      name: skills.name,
      description: skills.description,
      content: skills.content,
    })
    .from(skills)
    .where(eq(skills.visibility, "public"));

  const merged = new Map<string, (typeof boundRows)[number]>();
  for (const r of publicRows) merged.set(r.id, r);
  for (const r of workspaceRows) merged.set(r.id, r);
  for (const r of boundRows) merged.set(r.id, r); // bound overrides both

  if (merged.size === 0) return [];

  const skillIds = Array.from(merged.keys());
  const files = await db.select().from(skillFiles).where(inArray(skillFiles.skillId, skillIds));

  return Array.from(merged.values()).map((s) => ({
    skillId: s.id,
    name: s.name,
    description: s.description,
    content: s.content,
    files: files
      .filter((f) => f.skillId === s.id)
      .map((f) => ({ path: f.path, content: f.content })),
  }));
}

export async function broadcastSkillSyncForAgent(agentId: string): Promise<void> {
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent || !agent.runtimeId) return;
  const bundles = await bundlesForAgent(agentId);
  daemonHub.notifySkillSync(agent.runtimeId, { bundles, removeNames: [] });
}

export async function broadcastSkillSyncForSkill(skillId: string): Promise<void> {
  const bindings = await db
    .select({ agentId: agentSkills.agentId })
    .from(agentSkills)
    .where(eq(agentSkills.skillId, skillId));
  for (const b of bindings) await broadcastSkillSyncForAgent(b.agentId);
}

/**
 * Fan out a sync to every agent in a workspace. Used after a task
 * sediments a new workspace-visible skill (no bindings yet) — without
 * this, the row exists but no daemon writes the SKILL.md to disk until
 * each agent gets its next task. With this, agents that are currently
 * idle pick up the new skill within the WS round-trip so the next chat
 * message can already use it.
 */
export async function broadcastSkillSyncForWorkspace(workspaceId: string): Promise<void> {
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId));
  for (const r of rows) await broadcastSkillSyncForAgent(r.id);
}

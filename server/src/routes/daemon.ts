import {
  daemonClaimRequestSchema,
  daemonCompleteTaskSchema,
  daemonFailTaskSchema,
  daemonHeartbeatRequestSchema,
  daemonRegisterRequestSchema,
  daemonStartTaskSchema,
  daemonTaskMessagesBatchSchema,
} from "@agora/shared";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import {
  agentSkills,
  agentTaskQueue,
  agents,
  autopilotRuns,
  autopilots,
  chatSessions,
  comments,
  inboxItems,
  issues,
  members,
  projectResources,
  projects,
  runtimes,
  skills,
  taskMessages,
  userConnections,
  users,
  workspaceKnowledgeDocs,
  workspaces,
} from "../db/schema/index";
import { daemonHub } from "../lib/daemon-hub";
import {
  claimNextTaskForRuntime,
  getResumeSession,
  recoverOrphansForRuntime,
} from "../lib/enqueue";
import { jsonError, notFound } from "../lib/errors";
import { notifyIssueHumans } from "../lib/escalation";
import { generateMachineToken } from "../lib/machine-token";
import { mintTaskJwt } from "../lib/task-jwt";
import { decryptToken } from "../lib/token-crypto";
import { broadcastTask, broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { daemonAuthMiddleware } from "../middleware/daemon-auth";
import { workspaceMiddleware } from "../middleware/workspace";
import { syncRunFromTask } from "../services/autopilot";
import { appendAssistantFailure, appendAssistantReply } from "../services/chat";
import { decideRetry, requeueForRetry } from "../services/task-retry";

const TASK_JWT_SECRET = process.env.TASK_JWT_SECRET ?? "dev-task-secret-change-me!!!!!!!!";
const TASK_JWT_TTL = 60 * 60 * 6;

// Pull the requester user id back out of the task's triggerSummary. We
// stuff "quick-create by <uuid>" in there at enqueue time; pulling it
// out here avoids a schema migration just to track the requester. If
// the parse fails (e.g. autopilot task), returns null and the inbox
// step is skipped.
function quickCreateRequesterId(triggerSummary: string | null | undefined): string | null {
  if (!triggerSummary) return null;
  const m = triggerSummary.match(/quick-create by ([0-9a-f-]{36})/);
  return m?.[1] ?? null;
}

// Insert an inbox item for the quick-create requester when their agent
// task lands. On success, we look up the issue the agent stamped with
// origin_id=task.id and link it; on failure or if no issue was filed,
// the item still appears so the user knows the run finished.
async function notifyQuickCreateRequester(
  task: typeof agentTaskQueue.$inferSelect,
  outcome: "completed" | "failed",
  errorMessage?: string | null,
): Promise<void> {
  if (task.originType !== "quick_create") return;
  const requesterId = quickCreateRequesterId(task.triggerSummary);
  if (!requesterId) return;

  const stampedIssue = await db.query.issues.findFirst({
    where: and(eq(issues.workspaceId, task.workspaceId), eq(issues.originId, task.id)),
  });

  const promptPreview = (task.quickCreatePrompt ?? "").slice(0, 80);
  const titleSuffix = promptPreview ? `: ${promptPreview}` : "";

  const values =
    outcome === "completed"
      ? {
          workspaceId: task.workspaceId,
          recipientKind: "member" as const,
          recipientId: requesterId,
          type: "quick_create_completed",
          severity: "info" as const,
          issueId: stampedIssue?.id ?? null,
          title: stampedIssue
            ? `Agent finished — ${stampedIssue.title}`
            : `Agent finished${titleSuffix}`,
          body: stampedIssue
            ? null
            : "The agent ran but didn't file an issue. Check the prompt or try again.",
        }
      : {
          workspaceId: task.workspaceId,
          recipientKind: "member" as const,
          recipientId: requesterId,
          type: "quick_create_failed",
          severity: "action_required" as const,
          issueId: stampedIssue?.id ?? null,
          title: `Agent failed${titleSuffix}`,
          body: errorMessage ?? null,
        };

  const [inserted] = await db.insert(inboxItems).values(values).returning();
  if (inserted) {
    broadcastWorkspace(task.workspaceId, {
      type: "inbox.created",
      data: { id: inserted.id, recipientId: inserted.recipientId },
    });
  }
}

const app = new Hono();

const provision = new Hono();
provision.use("/api/workspaces/:workspaceId/runtimes/provision", authMiddleware);
provision.use("/api/workspaces/:workspaceId/runtimes/provision", workspaceMiddleware);
provision.post("/api/workspaces/:workspaceId/runtimes/provision", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const body = await c.req.json();
  const name = String(body?.name ?? "").trim();
  if (!name) return jsonError(c, 400, "name is required");
  const member = await db.query.members.findFirst({
    where: and(eq(members.workspaceId, workspaceId), eq(members.userId, user.id)),
  });
  if (!member) return jsonError(c, 403, "Not a member");

  // Idempotent on (workspace, member, name): each device should have ONE
  // runtime per workspace, not N. Daemon restart rotates the machine token
  // and reuses the same runtime row so the agents-page links and orphan
  // recovery stay anchored to a stable id.
  const tok = generateMachineToken();
  const existing = await db.query.runtimes.findFirst({
    where: and(
      eq(runtimes.workspaceId, workspaceId),
      eq(runtimes.memberId, member.id),
      eq(runtimes.name, name),
    ),
  });
  if (existing) {
    const [updated] = await db
      .update(runtimes)
      .set({ machineTokenHash: tok.hash, updatedAt: new Date() })
      .where(eq(runtimes.id, existing.id))
      .returning();
    if (!updated) return jsonError(c, 500, "Failed to rotate runtime token");
    return c.json({ runtimeId: updated.id, machineToken: tok.token });
  }
  const [r] = await db
    .insert(runtimes)
    .values({
      workspaceId,
      memberId: member.id,
      name,
      machineTokenHash: tok.hash,
      daemonVersion: "",
    })
    .returning();
  if (!r) return jsonError(c, 500, "Failed to provision runtime");
  return c.json({ runtimeId: r.id, machineToken: tok.token });
});
app.route("/", provision);

const dApp = new Hono();
dApp.use("/api/daemon/*", daemonAuthMiddleware);

dApp.post("/api/daemon/register", async (c) => {
  const runtime = c.get("runtime");
  const body = await c.req.json();
  const parsed = daemonRegisterRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  // Don't overwrite the name — provision set it (with CLI suffix) and the
  // unique(workspace, member, name) constraint trips if we rename to a
  // value that another runtime in the same workspace already uses (e.g.
  // a stale row from a previous setup flow).
  const [updated] = await db
    .update(runtimes)
    .set({
      daemonVersion: parsed.data.daemonVersion,
      detectedClis: parsed.data.detectedClis,
      runtimeInfo: parsed.data.runtimeInfo,
      online: true,
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(runtimes.id, runtime.id))
    .returning();
  if (!updated) return notFound(c, "Runtime");
  await recoverOrphansForRuntime(runtime.id);
  broadcastWorkspace(updated.workspaceId, {
    type: "runtime.online",
    data: { id: updated.id, workspaceId: updated.workspaceId },
  });
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, updated.workspaceId) });
  return c.json({
    runtimeId: updated.id,
    workspaceId: updated.workspaceId,
    repos: ws?.repos ?? [],
  });
});

dApp.post("/api/daemon/heartbeat", async (c) => {
  const runtime = c.get("runtime");
  const body = await c.req.json().catch(() => ({}));
  const parsed = daemonHeartbeatRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  await db
    .update(runtimes)
    .set({
      online: true,
      lastHeartbeatAt: new Date(),
      detectedClis: parsed.data.detectedClis ?? runtime.detectedClis,
      updatedAt: new Date(),
    })
    .where(eq(runtimes.id, runtime.id));
  return c.json({ ok: true, ts: new Date().toISOString() });
});

dApp.post("/api/daemon/deregister", async (c) => {
  const runtime = c.get("runtime");
  await db
    .update(runtimes)
    .set({ online: false, lastHeartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(runtimes.id, runtime.id));
  broadcastWorkspace(runtime.workspaceId, {
    type: "runtime.offline",
    data: { id: runtime.id, workspaceId: runtime.workspaceId },
  });
  return c.json({ ok: true });
});

dApp.post("/api/daemon/runtimes/:runtimeId/tasks/claim", async (c) => {
  const runtime = c.get("runtime");
  const runtimeIdParam = c.req.param("runtimeId");
  if (runtimeIdParam !== runtime.id) return jsonError(c, 403, "runtime mismatch");
  const parsed = daemonClaimRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const task = await claimNextTaskForRuntime(runtime.id);
  if (!task) return c.body(null, 204);

  // ---- Wave 1: fan out everything that only needs the claimed task in
  // hand. Previously each of these ran serially — 6 sequential RTTs against
  // Postgres. With the task row in memory, none of them depend on each
  // other, so Promise.all collapses the wave into a single RTT bound by
  // the slowest query. claimNextTaskForRuntime above counts as RTT #1; the
  // wave below is RTT #2. ----
  const [
    agent,
    issue,
    priorSessionFromIssue,
    chatSessionRow,
    triggerCommentRow,
    workspaceRow,
    agentSkillRows,
    autopilotRunRow,
    knowledgeRows,
    teamAgentRows,
    recentTaskRows,
  ] = await Promise.all([
    db.query.agents.findFirst({ where: eq(agents.id, task.agentId) }),
    task.issueId
      ? db.query.issues.findFirst({ where: eq(issues.id, task.issueId) })
      : Promise.resolve(null),
    // priorSession when the task is issue-attached. Chat-session resume is
    // handled below from chatSessionRow because we need the row anyway.
    task.issueId && !task.forceFreshSession
      ? getResumeSession(task.agentId, task.issueId)
      : Promise.resolve(null),
    task.chatSessionId && !task.forceFreshSession
      ? db.query.chatSessions.findFirst({
          where: eq(chatSessions.id, task.chatSessionId),
        })
      : Promise.resolve(null),
    task.triggerCommentId
      ? db.query.comments.findFirst({
          where: eq(comments.id, task.triggerCommentId),
        })
      : Promise.resolve(null),
    db.query.workspaces.findFirst({
      where: eq(workspaces.id, task.workspaceId),
    }),
    db
      .select({ name: skills.name })
      .from(agentSkills)
      .innerJoin(skills, eq(skills.id, agentSkills.skillId))
      .where(eq(agentSkills.agentId, task.agentId)),
    task.autopilotRunId
      ? db.query.autopilotRuns.findFirst({
          where: eq(autopilotRuns.id, task.autopilotRunId),
        })
      : Promise.resolve(null),
    // Workspace knowledge — inlined into CLAUDE.md by the daemon-side
    // renderer. We fetch ALL workspace docs here (workspace-wide +
    // every project) and filter to the relevant scope below once we
    // know which issue / project this task belongs to. Cheaper than
    // a follow-up query, and the doc bodies are budget-capped on the
    // renderer side anyway.
    db
      .select({
        kind: workspaceKnowledgeDocs.kind,
        title: workspaceKnowledgeDocs.title,
        content: workspaceKnowledgeDocs.content,
        projectId: workspaceKnowledgeDocs.projectId,
      })
      .from(workspaceKnowledgeDocs)
      .where(eq(workspaceKnowledgeDocs.workspaceId, task.workspaceId))
      .orderBy(desc(workspaceKnowledgeDocs.updatedAt))
      .limit(60),
    // Team agent roster — every non-archived agent in this workspace except
    // the one running the task. Used by the daemon to render a "Team Agents"
    // block in CLAUDE.md so the agent immediately knows who to delegate to /
    // mention without first running `agora agent list`. Members trust each
    // other inside a workspace, so we ship name + description + a snippet
    // of instructions (the "what is this agent for" signal). customEnv /
    // mcpConfig stay off this payload because the daemon never needs them
    // and they'd just bloat CLAUDE.md.
    db
      .select({
        id: agents.id,
        name: agents.name,
        description: agents.description,
        instructions: agents.instructions,
        cliKind: agents.cliKind,
        model: agents.model,
        ownerId: agents.ownerId,
        runtimeId: agents.runtimeId,
        mcpConfig: agents.mcpConfig,
        maxConcurrentTasks: agents.maxConcurrentTasks,
      })
      .from(agents)
      .where(
        and(
          eq(agents.workspaceId, task.workspaceId),
          isNull(agents.archivedAt),
          ne(agents.id, task.agentId),
        ),
      )
      .orderBy(asc(agents.name))
      .limit(60),
    // Last 10 completed tasks for THIS agent. Surfaced into CLAUDE.md so
    // the agent can compare what it's been actually doing against its
    // own `description` and auto-update via `agora agent update` when
    // the description is stale. Cheap — index on (agentId, completedAt).
    db
      .select({
        triggerSummary: agentTaskQueue.triggerSummary,
        completedAt: agentTaskQueue.completedAt,
      })
      .from(agentTaskQueue)
      .where(
        and(
          eq(agentTaskQueue.agentId, task.agentId),
          eq(agentTaskQueue.status, "completed"),
        ),
      )
      .orderBy(desc(agentTaskQueue.completedAt))
      .limit(10),
  ]);

  if (!agent) return jsonError(c, 500, "agent missing");

  // Reconcile priorSession from whichever lane found it.
  let priorSession: { session_id: string | null; work_dir: string | null } | null =
    priorSessionFromIssue;
  if (!priorSession && chatSessionRow?.sessionId) {
    priorSession = { session_id: chatSessionRow.sessionId, work_dir: chatSessionRow.workDir };
  }

  // ---- Wave 2: anything that depends on a wave-1 row. triggerComment needs
  // its author (member/agent table lookup), project context needs the
  // issue's projectId, autopilot metadata needs the run's autopilotId.
  // Each branch is independently optional so we batch them too. ----
  const [
    triggerCommentAuthorUser,
    triggerCommentAuthorAgent,
    projectRow,
    autopilotRow,
    githubConnRow,
  ] = await Promise.all([
    triggerCommentRow && triggerCommentRow.authorKind === "member"
      ? db.query.users.findFirst({ where: eq(users.id, triggerCommentRow.authorId) })
      : Promise.resolve(null),
    triggerCommentRow && triggerCommentRow.authorKind === "agent"
      ? db.query.agents.findFirst({ where: eq(agents.id, triggerCommentRow.authorId) })
      : Promise.resolve(null),
    issue?.projectId
      ? db.query.projects.findFirst({ where: eq(projects.id, issue.projectId) })
      : Promise.resolve(null),
    autopilotRunRow
      ? db.query.autopilots.findFirst({
          where: eq(autopilots.id, autopilotRunRow.autopilotId),
        })
      : Promise.resolve(null),
    // The agent owner's GitHub connection — its token is injected into
    // the spawned CLI's env so the agent can git/gh as that user.
    agent.ownerId
      ? db.query.userConnections.findFirst({
          where: and(
            eq(userConnections.userId, agent.ownerId),
            eq(userConnections.kind, "github"),
            eq(userConnections.status, "connected"),
          ),
        })
      : Promise.resolve(null),
  ]);

  // projectResources depends on the project row landing in wave 2. Cheap
  // wave-3 (a single query) so we don't over-engineer it.
  const projectResourcesRows = projectRow
    ? await db.query.projectResources.findMany({
        where: eq(projectResources.projectId, projectRow.id),
      })
    : [];

  // ---- Project the wave outputs into the response shape. ----

  // Resolve the trigger comment (when this task was kicked off by an
  // @mention). The daemon needs the actual content + author so it can
  // embed "what the user said" into the agent prompt — without it the
  // agent only sees a summary like "(trigger: mentioned in comment)"
  // and has nothing actionable to work with.
  let triggerComment: {
    id: string;
    content: string;
    authorKind: "member" | "agent";
    authorName: string;
    createdAt: string;
  } | null = null;
  if (triggerCommentRow) {
    let authorName = "";
    if (triggerCommentRow.authorKind === "member" && triggerCommentAuthorUser) {
      authorName =
        triggerCommentAuthorUser.name?.trim() ||
        (triggerCommentAuthorUser.email ? triggerCommentAuthorUser.email.split("@")[0]! : "");
    } else if (triggerCommentRow.authorKind === "agent" && triggerCommentAuthorAgent) {
      authorName = triggerCommentAuthorAgent.name;
    }
    triggerComment = {
      id: triggerCommentRow.id,
      content: triggerCommentRow.content,
      authorKind: triggerCommentRow.authorKind,
      authorName,
      createdAt: triggerCommentRow.createdAt.toISOString(),
    };
  }

  // Workspace-scoped repos: stored as a jsonb column on the workspace row.
  // Shape varies historically — values may be { url } objects or plain
  // strings. Normalize to { url } so the daemon doesn't have to guess.
  const rawRepos = (workspaceRow?.repos ?? []) as unknown[];
  const repos = rawRepos
    .map((r) => {
      if (typeof r === "string") return { url: r };
      if (
        r &&
        typeof r === "object" &&
        "url" in r &&
        typeof (r as { url: unknown }).url === "string"
      ) {
        return { url: (r as { url: string }).url };
      }
      return null;
    })
    .filter((r): r is { url: string } => r !== null);

  // Project context: only when the issue belongs to a project. We fetch the
  // project + its resources alongside the claim so the daemon can render
  // them into CLAUDE.md without a second round-trip.
  const projectId: string | null = projectRow?.id ?? null;
  const projectTitle: string | null = projectRow?.title ?? null;
  const projectResourcesList = projectResourcesRows.map((r) => ({
    resourceType: r.resourceType,
    resourceRef: r.resourceRef,
    label: r.label,
  }));

  // Skill bindings for the agent. Joined to the skill row so we can return
  // human-readable names; the daemon passes name → buildClaudeMd which lists
  // them under the Skills section. The actual SKILL.md bodies are written
  // separately by skill-fs sync.
  const agentSkillsList = agentSkillRows.map((r) => ({ name: r.name }));

  // Autopilot context: only when the task is a run-only autopilot dispatch.
  // We include enough metadata for the prompt + CLAUDE.md to describe what
  // triggered the run; the agent uses `agora autopilot get` (when available)
  // for the rest.
  let autopilotRunId: string | null = null;
  let autopilotId: string | null = null;
  let autopilotTitle: string | null = null;
  let autopilotDescription: string | null = null;
  let autopilotSource: string | null = null;
  let autopilotTriggerPayload: string | null = null;
  if (autopilotRunRow) {
    autopilotRunId = autopilotRunRow.id;
    autopilotSource = autopilotRunRow.source;
    if (autopilotRunRow.triggerPayload != null) {
      try {
        autopilotTriggerPayload = JSON.stringify(autopilotRunRow.triggerPayload, null, 2);
      } catch {
        autopilotTriggerPayload = null;
      }
    }
    if (autopilotRow) {
      autopilotId = autopilotRow.id;
      autopilotTitle = autopilotRow.title;
      autopilotDescription = autopilotRow.description;
    }
  }

  // GitHub connection: the agent owner's token, decrypted so the daemon
  // can hand it to the CLI as GH_TOKEN/GITHUB_TOKEN. A decrypt failure
  // (rotated key, tampered row) degrades to null — never breaks the claim.
  let githubToken: string | null = null;
  if (githubConnRow) {
    const cfg = githubConnRow.config as { access_token?: string } | null;
    if (cfg?.access_token) {
      try {
        githubToken = decryptToken(cfg.access_token);
      } catch {
        githubToken = null;
      }
    }
  }

  const taskJwt = await mintTaskJwt(
    { taskId: task.id, agentId: task.agentId, workspaceId: task.workspaceId },
    TASK_JWT_SECRET,
    TASK_JWT_TTL,
  );
  return c.json({
    task: {
      id: task.id,
      workspaceId: task.workspaceId,
      agentId: task.agentId,
      issueId: task.issueId,
      chatSessionId: task.chatSessionId,
      triggerCommentId: task.triggerCommentId,
      triggerComment,
      triggerSummary: task.triggerSummary,
      quickCreatePrompt: task.quickCreatePrompt,
      chatPrompt: task.chatSessionId ? task.quickCreatePrompt : null,
      originType: task.originType,
      priorSession,
      // Surface attempt to the prompt template so the agent
      // can adapt instructions for first-run vs. retry vs. continuation.
      attempt: task.attempt ?? 1,
      // Non-null when this is a retry/rerun dispatched by the server's
      // task-retry system. The daemon uses this to suppress skill
      // sedimentation on reruns — sedimenting the same lesson twice would
      // pollute the workspace knowledge base.
      parentTaskId: task.parentTaskId ?? null,
      autopilotRunId,
      autopilotId,
      autopilotTitle,
      autopilotDescription,
      autopilotSource,
      autopilotTriggerPayload,
    },
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      cliKind: agent.cliKind,
      model: agent.model,
      customEnv: agent.customEnv,
      customArgs: agent.customArgs,
      mcpConfig: agent.mcpConfig,
      instructions: agent.instructions,
      // Optional Liquid prompt overrides keyed by trigger kind. Empty `{}`
      // means "use the legacy hardcoded builders in local/src/prompts.ts".
      promptTemplates: agent.promptTemplates ?? {},
    },
    issue,
    repos,
    projectId,
    projectTitle,
    projectResources: projectResourcesList,
    agentSkills: agentSkillsList,
    // Filter KB rows to the relevant scope:
    //   - workspace-wide docs (projectId IS NULL) ALWAYS go through
    //   - project-scoped docs ONLY when this task targets an issue
    //     in that project. Other projects' docs are noise / leakage.
    //   - For chat / quick-create / autopilot run-only tasks (no
    //     issueId), only workspace-wide docs are relevant.
    knowledgeDocs: knowledgeRows
      .filter(
        (d) =>
          d.projectId === null ||
          (issue?.projectId !== undefined && d.projectId === issue.projectId),
      )
      .map(({ projectId: _, ...rest }) => rest),
    teamAgents: await enrichTeamAgents(teamAgentRows),
    recentTasks: recentTaskRows.map((r) => ({
      triggerSummary: r.triggerSummary,
      // Defensive: completedAt is non-null because of the status filter
      // above, but TypeScript can't see through the .where(). Cast safely.
      completedAt: (r.completedAt ?? new Date()).toISOString(),
    })),
    taskToken: taskJwt,
    // The agent owner's GitHub token (when they connected GitHub), for
    // the daemon to inject as GH_TOKEN/GITHUB_TOKEN. null when absent.
    githubToken,
  });
});

/**
 * Pivot the bare agent rows into the routing-decision payload that goes
 * into CLAUDE.md. Three extra batched queries hang off this function:
 *   - skills per agent (agent_skills × skills join, grouped in memory)
 *   - active task count per agent (queued/dispatched/running)
 *   - online status of each agent's runtime
 *
 * MCP server names come straight off agent.mcpConfig (top-level keys
 * only — credentials and command lines stay out of CLAUDE.md). Every
 * other agent in this workspace gets the full record because team
 * members trust each other; what we ship here is what makes another
 * agent able to answer "should I delegate this to teammate X?":
 *   - capabilities: skills + MCP servers (the strong signals)
 *   - availability: runtime online + load vs. cap (don't route to
 *                   offline / saturated agents)
 *   - identity:     name / description / instructions snippet (weak,
 *                   but kept because some teams DO write rich ones)
 */
async function enrichTeamAgents(
  rows: Array<{
    id: string;
    name: string;
    description: string;
    instructions: string;
    cliKind: string;
    model: string | null;
    ownerId: string | null;
    runtimeId: string | null;
    mcpConfig: unknown;
    maxConcurrentTasks: number;
  }>,
): Promise<
  Array<{
    id: string;
    name: string;
    description: string;
    instructions: string;
    cliKind: string;
    model: string | null;
    ownerId: string | null;
    skills: string[];
    mcpServers: string[];
    runtimeOnline: boolean | null;
    loadActive: number;
    loadCap: number;
  }>
> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const runtimeIds = Array.from(
    new Set(rows.map((r) => r.runtimeId).filter((r): r is string => r !== null)),
  );

  const [skillRows, loadRows, runtimeRows] = await Promise.all([
    db
      .select({ agentId: agentSkills.agentId, name: skills.name })
      .from(agentSkills)
      .innerJoin(skills, eq(skills.id, agentSkills.skillId))
      .where(inArray(agentSkills.agentId, ids)),
    db
      .select({
        agentId: agentTaskQueue.agentId,
        n: sql<number>`COUNT(*)::int`.as("n"),
      })
      .from(agentTaskQueue)
      .where(
        and(
          inArray(agentTaskQueue.agentId, ids),
          inArray(agentTaskQueue.status, ["queued", "dispatched", "running"]),
        ),
      )
      .groupBy(agentTaskQueue.agentId),
    runtimeIds.length > 0
      ? db
          .select({ id: runtimes.id, online: runtimes.online })
          .from(runtimes)
          .where(inArray(runtimes.id, runtimeIds))
      : Promise.resolve([] as Array<{ id: string; online: boolean }>),
  ]);

  const skillsByAgent = new Map<string, string[]>();
  for (const r of skillRows) {
    const arr = skillsByAgent.get(r.agentId);
    if (arr) arr.push(r.name);
    else skillsByAgent.set(r.agentId, [r.name]);
  }
  const loadByAgent = new Map<string, number>();
  for (const r of loadRows) loadByAgent.set(r.agentId, Number(r.n));
  const onlineByRuntime = new Map<string, boolean>();
  for (const r of runtimeRows) onlineByRuntime.set(r.id, r.online);

  return rows.map((r) => {
    const mcp = r.mcpConfig;
    const mcpServers =
      mcp && typeof mcp === "object" && !Array.isArray(mcp) ? Object.keys(mcp) : [];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      // Truncate per-agent so a few wordy instruction blocks don't blow
      // up CLAUDE.md. The renderer also enforces a global cap.
      instructions: r.instructions ? r.instructions.slice(0, 500) : "",
      cliKind: r.cliKind,
      model: r.model,
      ownerId: r.ownerId,
      skills: (skillsByAgent.get(r.id) ?? []).sort(),
      mcpServers: mcpServers.sort(),
      runtimeOnline: r.runtimeId ? (onlineByRuntime.get(r.runtimeId) ?? false) : null,
      loadActive: loadByAgent.get(r.id) ?? 0,
      loadCap: r.maxConcurrentTasks,
    };
  });
}

dApp.post("/api/daemon/tasks/:taskId/start", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = daemonStartTaskSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const [t] = await db
    .update(agentTaskQueue)
    .set({
      status: "running",
      startedAt: new Date(),
      sessionId: parsed.data.sessionId ?? null,
      workDir: parsed.data.workDir ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(agentTaskQueue.id, taskId), eq(agentTaskQueue.status, "dispatched")))
    .returning();
  if (!t) return notFound(c, "Task");
  broadcastWorkspace(t.workspaceId, {
    type: "task.started",
    data: { id: t.id, agentId: t.agentId },
  });
  return c.json(t);
});

// Daemon batch-uploads agent execution messages so the web's per-task
// timeline (AgentRunCard expand) is populated in near-real-time. Retries
// must be safe — the (task_id, seq) unique index plus onConflictDoNothing
// makes inserts idempotent. We broadcast a single workspace event carrying
// the highest seq so subscribers can refetch /messages?since=<lastSeen>.
dApp.post("/api/daemon/tasks/:taskId/messages", async (c) => {
  const runtime = c.get("runtime");
  const taskId = c.req.param("taskId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = daemonTaskMessagesBatchSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  // Verify the calling runtime actually owns this task — a token leak
  // across runtimes must not let one daemon write into another's task stream.
  const task = await db.query.agentTaskQueue.findFirst({
    where: and(eq(agentTaskQueue.id, taskId), eq(agentTaskQueue.runtimeId, runtime.id)),
  });
  if (!task) return notFound(c, "Task");

  const rows = parsed.data.messages.map((m) => ({
    taskId: task.id,
    seq: m.seq,
    kind: m.kind,
    // jsonb column — pass the value through; drizzle handles serialization.
    content: m.content ?? null,
  }));

  await db
    .insert(taskMessages)
    .values(rows)
    .onConflictDoNothing({ target: [taskMessages.taskId, taskMessages.seq] });

  // Re-derive latestSeq from the persisted state instead of returning the
  // batch's max. The daemon retry path can resubmit older seqs that are
  // deduped by the unique index — we don't want the response to lie about
  // having advanced the stream when nothing new actually landed.
  const [maxRow] = await db
    .select({ maxSeq: sql<number | null>`MAX(${taskMessages.seq})` })
    .from(taskMessages)
    .where(eq(taskMessages.taskId, task.id));
  const latestSeq = maxRow?.maxSeq ?? 0;

  // High-frequency event: a running agent can produce dozens of seq
  // increments per minute. Fan to the per-task channel only — clients
  // that have an AgentRunCard expanded explicitly subscribed via
  // {type:"subscribe:task", taskId}, so workspace members who aren't
  // looking at this card don't pay the wakeup cost.
  broadcastTask(task.id, {
    type: "task.messages_appended",
    data: { id: task.id, workspaceId: task.workspaceId, latestSeq },
  });

  return c.json({ ok: true, latestSeq });
});

dApp.post("/api/daemon/tasks/:taskId/complete", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = daemonCompleteTaskSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const [t] = await db
    .update(agentTaskQueue)
    .set({
      status: "completed",
      completedAt: new Date(),
      result: parsed.data.result,
      sessionId: parsed.data.sessionId ?? undefined,
      workDir: parsed.data.workDir ?? undefined,
      // Token + cost usage extracted from the CLI's JSON tail. Stored
      // verbatim into the `usage` jsonb column so the workspace
      // UI / billing surface can roll it up.
      usage: parsed.data.usage ?? undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(agentTaskQueue.id, taskId), eq(agentTaskQueue.status, "running")))
    .returning();
  if (!t) return notFound(c, "Task");
  if (t.chatSessionId && typeof parsed.data.result?.reply === "string") {
    const reply = parsed.data.result.reply.trim();
    if (reply.length > 0) {
      const elapsedMs =
        t.startedAt && t.completedAt ? t.completedAt.getTime() - t.startedAt.getTime() : null;
      await appendAssistantReply({
        workspaceId: t.workspaceId,
        sessionId: t.chatSessionId,
        taskId: t.id,
        content: reply,
        elapsedMs,
      });
    }
    if (parsed.data.sessionId || parsed.data.workDir) {
      await db
        .update(chatSessions)
        .set({
          sessionId: parsed.data.sessionId ?? undefined,
          workDir: parsed.data.workDir ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(chatSessions.id, t.chatSessionId));
    }
  }
  await notifyQuickCreateRequester(t, "completed");
  await syncRunFromTask(t);
  broadcastWorkspace(t.workspaceId, {
    type: "task.completed",
    data: { id: t.id, issueId: t.issueId },
  });
  // The agent's max-concurrent-tasks gate means the daemon's last claim
  // returned 204 if anything was queued. Now that this slot is free,
  // wake the daemon so it drains the next queued task right away
  // instead of sleeping until something else triggers task.available.
  daemonHub.notifyTaskAvailable(t.runtimeId, t.id);
  return c.json(t);
});

dApp.post("/api/daemon/tasks/:taskId/fail", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = daemonFailTaskSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const [t] = await db
    .update(agentTaskQueue)
    .set({
      status: "failed",
      completedAt: new Date(),
      error: parsed.data.error,
      failureReason: parsed.data.failureReason ?? "agent_error",
      errorKind: parsed.data.errorKind ?? "unknown",
      sessionId: parsed.data.sessionId ?? undefined,
      workDir: parsed.data.workDir ?? undefined,
      usage: parsed.data.usage ?? undefined,
      updatedAt: new Date(),
    })
    .where(
      and(eq(agentTaskQueue.id, taskId), inArray(agentTaskQueue.status, ["dispatched", "running"])),
    )
    .returning();
  if (!t) return notFound(c, "Task");
  // Transient failures get rescheduled with exponential
  // backoff. Deterministic failures (prompt_render_error, etc.) skip the
  // retry path so the loop doesn't spin on a broken template forever.
  const decision = decideRetry({
    attempt: t.attempt,
    maxAttempts: t.maxAttempts,
    errorKind: parsed.data.errorKind,
  });
  if (decision.kind === "retry") {
    await requeueForRetry({
      taskId: t.id,
      nextAttempt: decision.nextAttempt,
      dueAt: decision.dueAt,
      // decideRetry already enforced this is a retryable kind, so we know it's
      // one of the enum values. The `?? "unknown"` is dead-but-tidy.
      errorKind: (parsed.data.errorKind ?? "unknown") as Parameters<
        typeof requeueForRetry
      >[0]["errorKind"],
    });
    // Skip the chat-failure / quick-create / run sync paths for now —
    // those are terminal-failure side effects. The next claim will pick
    // the row up after the backoff window.
    return c.json({ ...t, status: "queued", attempt: decision.nextAttempt });
  }
  if (t.chatSessionId) {
    await appendAssistantFailure({
      workspaceId: t.workspaceId,
      sessionId: t.chatSessionId,
      taskId: t.id,
      failureReason: t.failureReason ?? "agent_error",
      errorMessage: t.error ?? "The agent failed to respond.",
    });
  }
  await notifyQuickCreateRequester(t, "failed", t.error);
  await syncRunFromTask(t);
  // Plain issue tasks: a terminal failure would otherwise be silent (only
  // the task.failed WS broadcast — lost if no browser is open). Deliver an
  // inbox item so a human knows an agent couldn't finish. quick_create is
  // skipped — notifyQuickCreateRequester already inboxed its requester.
  if (t.issueId && t.originType !== "quick_create") {
    const failedIssue = await db.query.issues.findFirst({ where: eq(issues.id, t.issueId) });
    if (failedIssue) {
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, t.workspaceId),
      });
      const identifier = ws ? `${ws.issuePrefix}-${failedIssue.number}` : `#${failedIssue.number}`;
      await notifyIssueHumans({
        workspaceId: t.workspaceId,
        issueId: t.issueId,
        type: "issue_task_failed",
        severity: "attention",
        title: `${identifier} — agent task failed`,
        body: t.error ?? t.failureReason ?? "The agent failed to complete this task.",
      });
    }
  }
  broadcastWorkspace(t.workspaceId, {
    type: "task.failed",
    data: { id: t.id, issueId: t.issueId, reason: t.failureReason ?? "agent_error" },
  });
  // Drain queue now that the slot is free.
  daemonHub.notifyTaskAvailable(t.runtimeId, t.id);
  return c.json(t);
});

app.route("/", dApp);
export default app;

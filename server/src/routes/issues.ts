import {
  batchDeleteIssuesSchema,
  batchUpdateIssuesSchema,
  createIssueSchema,
  escalateIssueSchema,
  searchIssuesSchema,
  updateIssueSchema,
} from "@agora/shared";
import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import {
  agents,
  comments,
  issueLabels,
  issueToLabel,
  issues,
  workspaces,
} from "../db/schema/index";
import { logActivity } from "../lib/activity";
import { resolveAssignee } from "../lib/assignee-resolver";
import { enqueueTaskForIssue } from "../lib/enqueue";
import { forbidden, jsonError, notFound } from "../lib/errors";
import { notifyIssueHumans } from "../lib/escalation";
import {
  issueIdentifier,
  issueToJson,
  issueToJsonSingle,
  loadActorsForIssues,
  loadLabelsForIssues,
  pickActor,
} from "../lib/issue-serializer";
import { ensureSubscribed, notifySubscribers } from "../lib/subscribe";
import { hub } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";
import { syncRunFromIssue } from "../services/autopilot";
import { sweepUnblocked } from "../services/issue-unblock";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

// GET /api/workspaces/:workspaceId/issues
app.get("/api/workspaces/:workspaceId/issues", async (c) => {
  const workspaceId = c.get("workspaceId");
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!ws) return notFound(c, "Workspace");

  const status = c.req.query("status");
  const projectId = c.req.query("projectId");
  const conditions = [eq(issues.workspaceId, workspaceId)];
  if (status) {
    conditions.push(eq(issues.status, status as (typeof issues.$inferSelect)["status"]));
  }
  if (projectId) {
    conditions.push(eq(issues.projectId, projectId));
  }

  const rows = await db.query.issues.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 100,
  });

  const [actorMaps, labelMap] = await Promise.all([
    loadActorsForIssues(rows),
    loadLabelsForIssues(rows.map((r) => r.id)),
  ]);
  const result = rows.map((i) =>
    issueToJson(i, ws.issuePrefix, {
      creator: pickActor(actorMaps, i.creatorKind, i.creatorId),
      assignee: pickActor(actorMaps, i.assigneeKind, i.assigneeId),
      labels: labelMap.get(i.id) ?? [],
    }),
  );
  return c.json(result);
});

// GET /api/workspaces/:workspaceId/issues/search
app.get("/api/workspaces/:workspaceId/issues/search", async (c) => {
  const workspaceId = c.get("workspaceId");
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!ws) return notFound(c, "Workspace");

  const parsed = searchIssuesSchema.safeParse(c.req.query());
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);
  const { q, offset, limit } = parsed.data;

  const words = q.trim().split(/\s+/).filter(Boolean);
  let query = db.select().from(issues).where(eq(issues.workspaceId, workspaceId)).$dynamic();

  for (const word of words) {
    query = query.where(ilike(issues.title, `%${word}%`));
  }

  const rows = await query.limit(limit).offset(offset);
  const countConditions = [
    eq(issues.workspaceId, workspaceId),
    ...words.map((w) => ilike(issues.title, `%${w}%`)),
  ];
  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(issues)
    .where(and(...countConditions));

  const result = rows.map((i) => ({
    id: i.id,
    identifier: issueIdentifier(ws.issuePrefix, i.number),
    title: i.title,
    status: i.status,
    priority: i.priority,
    snippet: i.description?.slice(0, 120) ?? null,
  }));

  return c.json({
    items: result,
    total: totalRows[0]?.count ?? 0,
    offset,
    limit,
  });
});

// GET /api/workspaces/:workspaceId/issues/:issueId
app.get("/api/workspaces/:workspaceId/issues/:issueId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!ws) return notFound(c, "Workspace");

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");
  return c.json(await issueToJsonSingle(issue, ws.issuePrefix));
});

// POST /api/workspaces/:workspaceId/issues
app.post("/api/workspaces/:workspaceId/issues", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const taskAuth = c.get("taskAuth");
  const body = await c.req.json();
  const parsed = createIssueSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  // Resolve fuzzy `assigneeName` to a concrete (kind, id). When the caller
  // also passed an explicit `assigneeId`, the id wins silently — this
  // avoids erroring on a script that sets both.
  let resolvedAssigneeKind: "member" | "agent" | undefined = parsed.data.assigneeKind;
  let resolvedAssigneeId: string | undefined = parsed.data.assigneeId;
  if (parsed.data.assigneeName && !parsed.data.assigneeId) {
    const result = await resolveAssignee(workspaceId, parsed.data.assigneeName);
    if (result.ambiguous) {
      return c.json(
        // Canonical `{ error: string }` shape so generic error handlers
        // (CLI, web ApiError) read the message straight from `.error`.
        // Auxiliary data lives under `.details` to keep the top level
        // uniform across every 4xx the server emits.
        { error: "Ambiguous assignee name", details: { candidates: result.candidates } },
        409,
      );
    }
    if (!result.matched) {
      return c.json({ error: `Assignee not found: ${parsed.data.assigneeName}` }, 404);
    }
    resolvedAssigneeKind = result.matched.kind;
    resolvedAssigneeId = result.matched.id;
  }

  // Atomically increment issue counter and get new number
  const [updated] = await db
    .update(workspaces)
    .set({ issueCounter: sql`${workspaces.issueCounter} + 1` })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  if (!updated) return notFound(c, "Workspace");

  // When the request comes via a task JWT (agora CLI spawned by daemon),
  // the agent is the creator and we trust the originType/originId stamp
  // so the daemon's complete handler can find this issue deterministically.
  const isAgentCall = !!taskAuth;
  const creatorKind: "member" | "agent" = isAgentCall ? "agent" : "member";
  const creatorId = isAgentCall ? taskAuth.agentId : user.id;
  const originType = isAgentCall && parsed.data.originType ? parsed.data.originType : null;
  const originId = isAgentCall && parsed.data.originId ? parsed.data.originId : null;

  const [issue] = await db
    .insert(issues)
    .values({
      workspaceId,
      number: updated.issueCounter,
      title: parsed.data.title,
      description: parsed.data.description,
      status: parsed.data.status,
      priority: parsed.data.priority,
      assigneeKind: resolvedAssigneeKind ?? null,
      assigneeId: resolvedAssigneeId ?? null,
      creatorKind,
      creatorId,
      parentIssueId: parsed.data.parentIssueId ?? null,
      projectId: parsed.data.projectId ?? null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      originType,
      originId,
    })
    .returning();

  if (!issue) return jsonError(c, 500, "Failed to create issue");

  // Auto-subscribe creator
  await ensureSubscribed(issue.id, "member", user.id, "creator");

  // Auto-subscribe assignee if set
  if (resolvedAssigneeId && resolvedAssigneeKind === "member") {
    await ensureSubscribed(issue.id, "member", resolvedAssigneeId, "assignee");
  }

  // Auto-enqueue task if assignee is an agent
  if (resolvedAssigneeKind === "agent" && resolvedAssigneeId) {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, resolvedAssigneeId), eq(agents.workspaceId, workspaceId)),
    });
    if (agent?.runtimeId && !agent.archivedAt) {
      try {
        await enqueueTaskForIssue({
          workspaceId,
          issueId: issue.id,
          agentId: agent.id,
          runtimeId: agent.runtimeId,
          triggerSummary: "issue assigned to agent",
        });
      } catch {
        // duplicate active task — ignore
      }
    }
  }

  await logActivity(
    workspaceId,
    "member",
    user.id,
    "issue.created",
    { title: parsed.data.title },
    issue.id,
  );

  hub.broadcast(`workspace:${workspaceId}`, {
    type: "issue.created",
    data: { id: issue.id, workspaceId },
  });

  return c.json(await issueToJsonSingle(issue, updated.issuePrefix), 201);
});

// PATCH /api/workspaces/:workspaceId/issues/:issueId
app.patch("/api/workspaces/:workspaceId/issues/:issueId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const issueId = c.req.param("issueId");
  const body = await c.req.json();
  const parsed = updateIssueSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const existing = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!existing) return notFound(c, "Issue");

  // See POST handler — explicit assigneeId beats assigneeName silently.
  let patchedAssigneeKind: "member" | "agent" | null | undefined = parsed.data.assigneeKind;
  let patchedAssigneeId: string | null | undefined = parsed.data.assigneeId;
  if (parsed.data.assigneeName && parsed.data.assigneeId === undefined) {
    const result = await resolveAssignee(workspaceId, parsed.data.assigneeName);
    if (result.ambiguous) {
      return c.json(
        // Canonical `{ error: string }` shape so generic error handlers
        // (CLI, web ApiError) read the message straight from `.error`.
        // Auxiliary data lives under `.details` to keep the top level
        // uniform across every 4xx the server emits.
        { error: "Ambiguous assignee name", details: { candidates: result.candidates } },
        409,
      );
    }
    if (!result.matched) {
      return c.json({ error: `Assignee not found: ${parsed.data.assigneeName}` }, 404);
    }
    patchedAssigneeKind = result.matched.kind;
    patchedAssigneeId = result.matched.id;
  }

  const update: Partial<typeof issues.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.priority !== undefined) update.priority = parsed.data.priority;
  if (patchedAssigneeKind !== undefined) update.assigneeKind = patchedAssigneeKind;
  if (patchedAssigneeId !== undefined) update.assigneeId = patchedAssigneeId;
  if (parsed.data.parentIssueId !== undefined) update.parentIssueId = parsed.data.parentIssueId;
  if (parsed.data.projectId !== undefined) update.projectId = parsed.data.projectId;
  if (parsed.data.dueDate !== undefined) {
    update.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  }

  const [updatedIssue] = await db
    .update(issues)
    .set(update)
    .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
    .returning();
  if (!updatedIssue) return notFound(c, "Issue");

  // Auto-subscribe new assignee
  if (
    patchedAssigneeId &&
    patchedAssigneeKind === "member" &&
    patchedAssigneeId !== existing.assigneeId
  ) {
    await ensureSubscribed(issueId, "member", patchedAssigneeId, "assignee");
  }

  // Auto-enqueue task if assignee changed to an agent
  if (
    patchedAssigneeKind === "agent" &&
    patchedAssigneeId &&
    (existing.assigneeKind !== "agent" || existing.assigneeId !== patchedAssigneeId)
  ) {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, patchedAssigneeId), eq(agents.workspaceId, workspaceId)),
    });
    if (agent?.runtimeId && !agent.archivedAt) {
      try {
        await enqueueTaskForIssue({
          workspaceId,
          issueId: existing.id,
          agentId: agent.id,
          runtimeId: agent.runtimeId,
          triggerSummary: "issue reassigned to agent",
        });
      } catch {
        // duplicate active task — ignore
      }
    }
  }

  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!ws) return notFound(c, "Workspace");

  // Activity log for status change
  if (parsed.data.status && parsed.data.status !== existing.status) {
    await logActivity(
      workspaceId,
      "member",
      user.id,
      "issue.status_changed",
      { from: existing.status, to: parsed.data.status },
      issueId,
    );

    await notifySubscribers(
      workspaceId,
      issueId,
      user.id,
      "issue_status_changed",
      `Issue ${ws.issuePrefix}-${existing.number} status changed to ${parsed.data.status}`,
      null,
    );
  }

  hub.broadcast(`workspace:${workspaceId}`, {
    type: "issue.updated",
    data: { id: issueId, workspaceId },
  });

  // If this issue was spawned by an autopilot and just hit a terminal state,
  // finalize the linked run. Non-blocking: failures here must not break the
  // PATCH response.
  if (
    (updatedIssue.status === "done" || updatedIssue.status === "cancelled") &&
    updatedIssue.originType === "autopilot"
  ) {
    await syncRunFromIssue(updatedIssue).catch(() => {
      /* non-blocking */
    });
  }

  // Linear-style unblock sweep: when this issue resolves, scan for any
  // blocked dependents and flip them back to `todo` (+ enqueue a task
  // for agent assignees). Fire-and-forget — sweep failures must not
  // break the PATCH; the agent / human can manually rerun the resolved
  // issue's status flip to retry.
  if (
    parsed.data.status &&
    parsed.data.status !== existing.status &&
    (updatedIssue.status === "done" || updatedIssue.status === "cancelled")
  ) {
    void sweepUnblocked(workspaceId, updatedIssue.id).catch((e) => {
      console.warn(
        `[issues] sweepUnblocked failed for ${updatedIssue.id}: ${(e as Error).message}`,
      );
    });
  }

  return c.json(await issueToJsonSingle(updatedIssue, ws.issuePrefix));
});

// POST /api/workspaces/:workspaceId/issues/:issueId/rerun
// Re-enqueue a task for an issue currently assigned to an agent. The agent
// must have a runtime; otherwise we 400. Used by `agora issue rerun <id>`.
app.post("/api/workspaces/:workspaceId/issues/:issueId/rerun", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");
  if (issue.assigneeKind !== "agent" || !issue.assigneeId) {
    return jsonError(c, 400, "Issue is not assigned to an agent");
  }

  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, issue.assigneeId), eq(agents.workspaceId, workspaceId)),
  });
  if (!agent) return notFound(c, "Agent");
  if (!agent.runtimeId || agent.archivedAt) {
    return jsonError(c, 400, "Agent has no active runtime");
  }

  let task;
  try {
    task = await enqueueTaskForIssue({
      workspaceId,
      issueId: issue.id,
      agentId: agent.id,
      runtimeId: agent.runtimeId,
      triggerSummary: "rerun",
    });
  } catch {
    // duplicate active task — surface as conflict so callers can react
    return jsonError(c, 409, "An active task for this issue already exists");
  }

  return c.json({ ok: true, taskId: task.id });
});

// POST /api/workspaces/:workspaceId/issues/:issueId/escalate
// An agent (or human) declares the issue can't be completed by any agent
// and hands it to a human: posts a system comment, flips the issue to
// `blocked`, and delivers an action_required inbox item to workspace
// owners/admins + issue subscribers. Used by `agora issue escalate`.
app.post("/api/workspaces/:workspaceId/issues/:issueId/escalate", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");
  const user = c.get("user");
  const taskAuth = c.get("taskAuth");

  const body = await c.req.json().catch(() => ({}));
  const parsed = escalateIssueSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!ws) return notFound(c, "Workspace");

  const isAgentCall = !!taskAuth;
  const authorKind: "member" | "agent" = isAgentCall ? "agent" : "member";
  const authorId = isAgentCall ? taskAuth.agentId : user.id;

  const [comment] = await db
    .insert(comments)
    .values({
      issueId,
      authorKind,
      authorId,
      content: `**Escalated to a human** — ${parsed.data.reason}`,
      type: "system",
    })
    .returning();

  // Flip to blocked unless the issue is already terminal or blocked.
  const terminal = issue.status === "done" || issue.status === "cancelled";
  if (!terminal && issue.status !== "blocked") {
    await db
      .update(issues)
      .set({ status: "blocked", updatedAt: new Date() })
      .where(eq(issues.id, issueId));
  }

  await logActivity(
    workspaceId,
    authorKind,
    authorId,
    "issue.escalated",
    { reason: parsed.data.reason },
    issueId,
  );

  const identifier = `${ws.issuePrefix}-${issue.number}`;
  await notifyIssueHumans({
    workspaceId,
    issueId,
    type: "issue_escalated",
    severity: "action_required",
    title: `${identifier} escalated — needs a human`,
    body: parsed.data.reason.slice(0, 500),
    // A human escalating doesn't need to notify themselves.
    excludeUserId: isAgentCall ? undefined : user.id,
  });

  hub.broadcast(`workspace:${workspaceId}`, {
    type: "issue.updated",
    data: { id: issueId, workspaceId },
  });
  if (comment) {
    hub.broadcast(`workspace:${workspaceId}`, {
      type: "comment.created",
      data: { id: comment.id, issueId },
    });
  }

  const updated = await db.query.issues.findFirst({ where: eq(issues.id, issueId) });
  // biome-ignore lint/style/noNonNullAssertion: issue existence verified above
  return c.json(await issueToJsonSingle(updated!, ws.issuePrefix));
});

// DELETE /api/workspaces/:workspaceId/issues/:issueId
app.delete("/api/workspaces/:workspaceId/issues/:issueId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");
  const role = c.get("memberRole");
  if (role === "member") return forbidden(c);

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  await db.delete(issues).where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)));

  hub.broadcast(`workspace:${workspaceId}`, {
    type: "issue.deleted",
    data: { id: issueId, workspaceId },
  });

  return c.body(null, 204);
});

// POST /api/workspaces/:workspaceId/issues/batch-update
app.post("/api/workspaces/:workspaceId/issues/batch-update", async (c) => {
  const workspaceId = c.get("workspaceId");
  const body = await c.req.json();
  const parsed = batchUpdateIssuesSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const { ids, ...fields } = parsed.data;
  const update: Partial<typeof issues.$inferInsert> = { updatedAt: new Date() };
  if (fields.status !== undefined) update.status = fields.status;
  if (fields.priority !== undefined) update.priority = fields.priority;
  if (fields.assigneeKind !== undefined) update.assigneeKind = fields.assigneeKind;
  if (fields.assigneeId !== undefined) update.assigneeId = fields.assigneeId;

  await db
    .update(issues)
    .set(update)
    .where(and(eq(issues.workspaceId, workspaceId), inArray(issues.id, ids)));

  for (const id of ids) {
    hub.broadcast(`workspace:${workspaceId}`, {
      type: "issue.updated",
      data: { id, workspaceId },
    });
  }

  // Same Linear-style unblock sweep as the single PATCH path. Fire on each
  // id when the batch flipped status to a terminal value.
  if (fields.status === "done" || fields.status === "cancelled") {
    for (const id of ids) {
      void sweepUnblocked(workspaceId, id).catch((e) => {
        console.warn(`[issues] sweepUnblocked (batch) failed for ${id}: ${(e as Error).message}`);
      });
    }
  }

  return c.json({ updated: ids.length });
});

// POST /api/workspaces/:workspaceId/issues/:issueId/labels
// Attach a single label to an issue. Body: { labelId }
app.post("/api/workspaces/:workspaceId/issues/:issueId/labels", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");
  const body = await c.req.json().catch(() => ({}));
  const labelId = typeof body?.labelId === "string" ? body.labelId : null;
  if (!labelId) return jsonError(c, 400, "labelId is required");

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const label = await db.query.issueLabels.findFirst({
    where: and(eq(issueLabels.id, labelId), eq(issueLabels.workspaceId, workspaceId)),
  });
  if (!label) return notFound(c, "Label");

  await db
    .insert(issueToLabel)
    .values({ issueId: issue.id, labelId: label.id, workspaceId })
    .onConflictDoNothing();

  hub.broadcast(`workspace:${workspaceId}`, {
    type: "issue.labels_changed",
    data: { issueId: issue.id, workspaceId },
  });
  // 201 Created with the binding so optimistic UIs don't need to refetch
  // to surface the new label.
  return c.json({ labelId: label.id, issueId: issue.id, workspaceId }, 201);
});

// DELETE /api/workspaces/:workspaceId/issues/:issueId/labels/:labelId
// Detach a single label from an issue.
app.delete("/api/workspaces/:workspaceId/issues/:issueId/labels/:labelId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");
  const labelId = c.req.param("labelId");

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  await db
    .delete(issueToLabel)
    .where(and(eq(issueToLabel.issueId, issue.id), eq(issueToLabel.labelId, labelId)));

  hub.broadcast(`workspace:${workspaceId}`, {
    type: "issue.labels_changed",
    data: { issueId: issue.id, workspaceId },
  });
  // 204 No Content — matches every other DELETE route in the codebase
  // (labels.ts, autopilots.ts, comments.ts, members.ts, skills.ts).
  return c.body(null, 204);
});

// POST /api/workspaces/:workspaceId/issues/batch-delete
app.post("/api/workspaces/:workspaceId/issues/batch-delete", async (c) => {
  const workspaceId = c.get("workspaceId");
  const role = c.get("memberRole");
  if (role === "member") return forbidden(c);

  const body = await c.req.json();
  const parsed = batchDeleteIssuesSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  await db
    .delete(issues)
    .where(and(eq(issues.workspaceId, workspaceId), inArray(issues.id, parsed.data.ids)));

  for (const id of parsed.data.ids) {
    hub.broadcast(`workspace:${workspaceId}`, {
      type: "issue.deleted",
      data: { id, workspaceId },
    });
  }

  return c.json({ deleted: parsed.data.ids.length });
});

export default app;

import {
  createAutopilotSchema,
  createAutopilotTriggerSchema,
  manualTriggerAutopilotSchema,
  updateAutopilotSchema,
  updateAutopilotTriggerSchema,
} from "@agora/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { agents, autopilotRuns, autopilotTriggers, autopilots } from "../db/schema/index";
import { computeNextRun, validateTimezone } from "../lib/cron";
import { forbidden, jsonError, notFound } from "../lib/errors";
import { generateWebhookToken } from "../lib/webhook-token";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";
import { dispatchAutopilot } from "../services/autopilot";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

function autopilotToJson(a: typeof autopilots.$inferSelect) {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    title: a.title,
    description: a.description,
    assigneeId: a.assigneeId,
    status: a.status,
    executionMode: a.executionMode,
    issueTitleTemplate: a.issueTitleTemplate,
    createdByKind: a.createdByKind,
    createdById: a.createdById,
    lastRunAt: a.lastRunAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function triggerToJson(t: typeof autopilotTriggers.$inferSelect, cleartextToken?: string) {
  return {
    id: t.id,
    autopilotId: t.autopilotId,
    kind: t.kind,
    enabled: t.enabled,
    cronExpression: t.cronExpression,
    timezone: t.timezone,
    nextRunAt: t.nextRunAt?.toISOString() ?? null,
    label: t.label,
    lastFiredAt: t.lastFiredAt?.toISOString() ?? null,
    // Cleartext returned ONLY on creation. Subsequent fetches omit this field
    // entirely (the hash is what's stored).
    webhookToken: cleartextToken,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function runToJson(r: typeof autopilotRuns.$inferSelect) {
  return {
    id: r.id,
    autopilotId: r.autopilotId,
    triggerId: r.triggerId,
    source: r.source,
    status: r.status,
    issueId: r.issueId,
    taskId: r.taskId,
    triggeredAt: r.triggeredAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    failureReason: r.failureReason,
    triggerPayload: r.triggerPayload,
    result: r.result,
    createdAt: r.createdAt.toISOString(),
  };
}

// ── Autopilot CRUD ──────────────────────────────────────────────────────────

app.get("/api/workspaces/:workspaceId/autopilots", async (c) => {
  const workspaceId = c.get("workspaceId");
  const rows = await db.query.autopilots.findMany({
    where: eq(autopilots.workspaceId, workspaceId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
  return c.json(rows.map(autopilotToJson));
});

app.post("/api/workspaces/:workspaceId/autopilots", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = createAutopilotSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  // Validate assignee is an agent in this workspace.
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, parsed.data.assigneeId), eq(agents.workspaceId, workspaceId)),
  });
  if (!agent) return jsonError(c, 400, "assignee must be an agent in this workspace");

  const [a] = await db
    .insert(autopilots)
    .values({
      workspaceId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      assigneeId: parsed.data.assigneeId,
      executionMode: parsed.data.executionMode,
      issueTitleTemplate: parsed.data.issueTitleTemplate ?? null,
      createdByKind: "member",
      createdById: user.id,
    })
    .returning();
  if (!a) return jsonError(c, 500, "failed to create autopilot");
  broadcastWorkspace(workspaceId, { type: "autopilot.created", data: { id: a.id, workspaceId } });
  return c.json(autopilotToJson(a), 201);
});

app.get("/api/workspaces/:workspaceId/autopilots/:id", async (c) => {
  const workspaceId = c.get("workspaceId");
  const id = c.req.param("id");
  const a = await db.query.autopilots.findFirst({
    where: and(eq(autopilots.id, id), eq(autopilots.workspaceId, workspaceId)),
  });
  if (!a) return notFound(c, "Autopilot");
  const triggers = await db.query.autopilotTriggers.findMany({
    where: eq(autopilotTriggers.autopilotId, a.id),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
  return c.json({
    autopilot: autopilotToJson(a),
    triggers: triggers.map((t) => triggerToJson(t)),
  });
});

app.patch("/api/workspaces/:workspaceId/autopilots/:id", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const id = c.req.param("id");
  const existing = await db.query.autopilots.findFirst({
    where: and(eq(autopilots.id, id), eq(autopilots.workspaceId, workspaceId)),
  });
  if (!existing) return notFound(c, "Autopilot");
  if (existing.createdById !== user.id && role === "member") return forbidden(c);
  const body = await c.req.json();
  const parsed = updateAutopilotSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  if (parsed.data.assigneeId) {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, parsed.data.assigneeId), eq(agents.workspaceId, workspaceId)),
    });
    if (!agent) return jsonError(c, 400, "assignee must be an agent in this workspace");
  }

  const [a] = await db
    .update(autopilots)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(autopilots.id, id))
    .returning();
  if (!a) return notFound(c, "Autopilot");
  broadcastWorkspace(workspaceId, { type: "autopilot.updated", data: { id: a.id, workspaceId } });
  return c.json(autopilotToJson(a));
});

app.delete("/api/workspaces/:workspaceId/autopilots/:id", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const id = c.req.param("id");
  const existing = await db.query.autopilots.findFirst({
    where: and(eq(autopilots.id, id), eq(autopilots.workspaceId, workspaceId)),
  });
  if (!existing) return notFound(c, "Autopilot");
  if (existing.createdById !== user.id && role === "member") return forbidden(c);
  await db.delete(autopilots).where(eq(autopilots.id, id));
  broadcastWorkspace(workspaceId, { type: "autopilot.deleted", data: { id, workspaceId } });
  return c.body(null, 204);
});

// ── Trigger CRUD ────────────────────────────────────────────────────────────

app.post("/api/workspaces/:workspaceId/autopilots/:id/triggers", async (c) => {
  const workspaceId = c.get("workspaceId");
  const id = c.req.param("id");
  const ap = await db.query.autopilots.findFirst({
    where: and(eq(autopilots.id, id), eq(autopilots.workspaceId, workspaceId)),
  });
  if (!ap) return notFound(c, "Autopilot");
  const body = await c.req.json();
  const parsed = createAutopilotTriggerSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  if (parsed.data.kind === "schedule") {
    if (!parsed.data.cronExpression) {
      return jsonError(c, 400, "cron_expression is required for schedule triggers");
    }
    if (parsed.data.timezone) {
      try {
        validateTimezone(parsed.data.timezone);
      } catch (err) {
        return jsonError(c, 400, (err as Error).message);
      }
    }
  }

  const tz = parsed.data.timezone ?? "UTC";
  let nextRunAt: Date | null = null;
  if (parsed.data.kind === "schedule" && parsed.data.cronExpression) {
    try {
      nextRunAt = computeNextRun(parsed.data.cronExpression, tz);
    } catch (err) {
      return jsonError(c, 400, (err as Error).message);
    }
  }

  let webhookCleartext: string | undefined;
  let webhookHash: string | null = null;
  if (parsed.data.kind === "webhook") {
    const t = generateWebhookToken();
    webhookCleartext = t.token;
    webhookHash = t.hash;
  }

  const [t] = await db
    .insert(autopilotTriggers)
    .values({
      autopilotId: ap.id,
      kind: parsed.data.kind,
      enabled: parsed.data.enabled,
      cronExpression: parsed.data.cronExpression ?? null,
      timezone: tz,
      nextRunAt,
      webhookTokenHash: webhookHash,
      label: parsed.data.label ?? null,
    })
    .returning();
  if (!t) return jsonError(c, 500, "failed to create trigger");
  broadcastWorkspace(workspaceId, { type: "autopilot.updated", data: { id: ap.id, workspaceId } });
  return c.json(triggerToJson(t, webhookCleartext), 201);
});

app.patch("/api/workspaces/:workspaceId/autopilots/:id/triggers/:triggerId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const id = c.req.param("id");
  const triggerId = c.req.param("triggerId");
  const ap = await db.query.autopilots.findFirst({
    where: and(eq(autopilots.id, id), eq(autopilots.workspaceId, workspaceId)),
  });
  if (!ap) return notFound(c, "Autopilot");
  const prev = await db.query.autopilotTriggers.findFirst({
    where: and(eq(autopilotTriggers.id, triggerId), eq(autopilotTriggers.autopilotId, ap.id)),
  });
  if (!prev) return notFound(c, "Trigger");
  const body = await c.req.json();
  const parsed = updateAutopilotTriggerSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  // Recompute next_run_at if cron or tz changed (only for schedule triggers).
  const cronExpr = parsed.data.cronExpression ?? prev.cronExpression;
  const tz = parsed.data.timezone ?? prev.timezone ?? "UTC";
  let nextRunAt = prev.nextRunAt;
  if (prev.kind === "schedule" && cronExpr) {
    try {
      nextRunAt = computeNextRun(cronExpr, tz);
    } catch (err) {
      return jsonError(c, 400, (err as Error).message);
    }
  }

  const [t] = await db
    .update(autopilotTriggers)
    .set({
      enabled: parsed.data.enabled ?? prev.enabled,
      cronExpression: cronExpr,
      timezone: tz,
      nextRunAt,
      label: parsed.data.label ?? prev.label,
      updatedAt: new Date(),
    })
    .where(eq(autopilotTriggers.id, triggerId))
    .returning();
  if (!t) return notFound(c, "Trigger");
  broadcastWorkspace(workspaceId, { type: "autopilot.updated", data: { id: ap.id, workspaceId } });
  return c.json(triggerToJson(t));
});

app.delete("/api/workspaces/:workspaceId/autopilots/:id/triggers/:triggerId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const id = c.req.param("id");
  const triggerId = c.req.param("triggerId");
  const ap = await db.query.autopilots.findFirst({
    where: and(eq(autopilots.id, id), eq(autopilots.workspaceId, workspaceId)),
  });
  if (!ap) return notFound(c, "Autopilot");
  await db
    .delete(autopilotTriggers)
    .where(and(eq(autopilotTriggers.id, triggerId), eq(autopilotTriggers.autopilotId, ap.id)));
  broadcastWorkspace(workspaceId, { type: "autopilot.updated", data: { id: ap.id, workspaceId } });
  return c.body(null, 204);
});

// ── Run history ─────────────────────────────────────────────────────────────

app.get("/api/workspaces/:workspaceId/autopilots/:id/runs", async (c) => {
  const workspaceId = c.get("workspaceId");
  const id = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const ap = await db.query.autopilots.findFirst({
    where: and(eq(autopilots.id, id), eq(autopilots.workspaceId, workspaceId)),
  });
  if (!ap) return notFound(c, "Autopilot");
  const rows = await db.query.autopilotRuns.findMany({
    where: eq(autopilotRuns.autopilotId, ap.id),
    orderBy: [desc(autopilotRuns.createdAt)],
    limit,
    offset,
  });
  return c.json({ runs: rows.map(runToJson), total: rows.length });
});

app.get("/api/workspaces/:workspaceId/autopilots/:id/runs/:runId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const id = c.req.param("id");
  const runId = c.req.param("runId");
  const ap = await db.query.autopilots.findFirst({
    where: and(eq(autopilots.id, id), eq(autopilots.workspaceId, workspaceId)),
  });
  if (!ap) return notFound(c, "Autopilot");
  const run = await db.query.autopilotRuns.findFirst({
    where: and(eq(autopilotRuns.id, runId), eq(autopilotRuns.autopilotId, ap.id)),
  });
  if (!run) return notFound(c, "Run");
  return c.json(runToJson(run));
});

// ── Manual trigger ──────────────────────────────────────────────────────────

app.post("/api/workspaces/:workspaceId/autopilots/:id/trigger", async (c) => {
  const workspaceId = c.get("workspaceId");
  const id = c.req.param("id");
  const ap = await db.query.autopilots.findFirst({
    where: and(eq(autopilots.id, id), eq(autopilots.workspaceId, workspaceId)),
  });
  if (!ap) return notFound(c, "Autopilot");
  if (ap.status !== "active") return jsonError(c, 400, "autopilot is not active");

  // Body is optional; default to {} when absent or malformed (the manual
  // trigger button posts no body). Only the payload field is read.
  const raw = await c.req.json().catch(() => ({}));
  const parsed = manualTriggerAutopilotSchema.safeParse(raw);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const run = await dispatchAutopilot(ap, {
    source: "manual",
    triggerPayload: parsed.data.payload ?? null,
  });
  return c.json(runToJson(run));
});

export default app;

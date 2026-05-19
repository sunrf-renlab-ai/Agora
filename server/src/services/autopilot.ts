import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentTaskQueue,
  agents,
  autopilotRuns,
  autopilots,
  issues,
  workspaces,
} from "../db/schema/index";
import { daemonHub } from "../lib/daemon-hub";
import { enqueueTaskForIssue } from "../lib/enqueue";
import { broadcastWorkspace } from "../lib/ws-hub";

type Autopilot = typeof autopilots.$inferSelect;
type Issue = typeof issues.$inferSelect;
type Task = typeof agentTaskQueue.$inferSelect;
type Run = typeof autopilotRuns.$inferSelect;

export type DispatchSource = "schedule" | "manual" | "webhook" | "api";

export interface DispatchOptions {
  source: DispatchSource;
  triggerId?: string | null;
  triggerPayload?: unknown;
}

/**
 * Core entry point for dispatching an autopilot.
 * Creates a run row, then either creates an issue + enqueues a task
 * (execution_mode=create_issue) or enqueues an issue-less task pointing
 * back at the run (execution_mode=run_only).
 *
 * Always returns the final run row (with status either issue_created/running or failed).
 * Throws only on programming errors; business failures are written to run.failureReason
 * and the run is returned with status='failed'.
 */
export async function dispatchAutopilot(ap: Autopilot, opts: DispatchOptions): Promise<Run> {
  if (ap.executionMode === "run_only") {
    return dispatchRunOnly(ap, opts);
  }

  // 1. Insert pending run as 'issue_created' (we'll fail it if anything below blows up).
  //    There's no checkpoint between insert and issue creation, so we skip an
  //    explicit pending state.
  const [pending] = await db
    .insert(autopilotRuns)
    .values({
      autopilotId: ap.id,
      triggerId: opts.triggerId ?? null,
      source: opts.source,
      status: "issue_created", // optimistic, rolled back to 'failed' on error
      triggerPayload: opts.triggerPayload ?? null,
    })
    .returning();
  if (!pending) throw new Error("dispatchAutopilot: failed to insert run");

  try {
    const issue = await createAutopilotIssue(ap);

    // Update run with linked issue.
    const [updated] = await db
      .update(autopilotRuns)
      .set({ issueId: issue.id })
      .where(eq(autopilotRuns.id, pending.id))
      .returning();
    if (!updated) throw new Error("dispatchAutopilot: run row vanished");

    // Bump autopilot.last_run_at.
    await db
      .update(autopilots)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(autopilots.id, ap.id));

    // Enqueue agent task (broadcasts task.queued + notifies daemon hub internally).
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, ap.assigneeId) });
    if (!agent) throw new Error(`agent ${ap.assigneeId} not found`);
    if (agent.archivedAt) throw new Error("agent is archived");
    if (!agent.runtimeId) throw new Error("agent has no runtime");
    const task = await enqueueTaskForIssue({
      workspaceId: ap.workspaceId,
      issueId: issue.id,
      agentId: agent.id,
      runtimeId: agent.runtimeId,
      triggerSummary: truncate(`autopilot: ${ap.title}`, 200),
    });

    // Link task↔run in both directions. The autopilot_run_id on the task
    // is what lets the daemon completion hook (syncRunFromTask) resolve
    // which run to close. taskId on the run is for the UI.
    await db
      .update(agentTaskQueue)
      .set({ autopilotRunId: updated.id })
      .where(eq(agentTaskQueue.id, task.id));

    const [runWithTask] = await db
      .update(autopilotRuns)
      .set({ taskId: task.id })
      .where(eq(autopilotRuns.id, updated.id))
      .returning();

    // Publish autopilot.run.start so web can update the run history.
    broadcastWorkspace(ap.workspaceId, {
      type: "autopilot.run.start",
      data: {
        runId: updated.id,
        autopilotId: ap.id,
        workspaceId: ap.workspaceId,
      },
    });

    // Also broadcast issue.created so existing subscribers update.
    broadcastWorkspace(ap.workspaceId, {
      type: "issue.created",
      data: { id: issue.id, workspaceId: ap.workspaceId },
    });

    return runWithTask ?? updated;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const [failed] = await db
      .update(autopilotRuns)
      .set({ status: "failed", failureReason: reason, completedAt: new Date() })
      .where(eq(autopilotRuns.id, pending.id))
      .returning();
    return failed ?? pending;
  }
}

/**
 * Creates an issue with origin_type='autopilot', atomically incrementing the
 * workspace issue_counter. Returns the new issue row.
 */
async function createAutopilotIssue(ap: Autopilot): Promise<Issue> {
  return await db.transaction(async (tx) => {
    // Atomic counter increment via UPDATE ... RETURNING.
    const [updated] = await tx
      .update(workspaces)
      .set({ issueCounter: sql`${workspaces.issueCounter} + 1`, updatedAt: new Date() })
      .where(eq(workspaces.id, ap.workspaceId))
      .returning();
    if (!updated) throw new Error("workspace not found");

    const title = interpolateTemplate(ap);
    const description = buildIssueDescription(ap);

    const [issue] = await tx
      .insert(issues)
      .values({
        workspaceId: ap.workspaceId,
        number: updated.issueCounter,
        title,
        description,
        status: "todo",
        priority: "none",
        assigneeKind: "agent",
        assigneeId: ap.assigneeId,
        creatorKind: ap.createdByKind,
        creatorId: ap.createdById,
        originType: "autopilot",
        originId: ap.id,
      })
      .returning();
    if (!issue) throw new Error("insert issue returned no row");
    return issue;
  });
}

/**
 * Replace `{{date}}` in title (or issueTitleTemplate if set) with today's UTC date.
 */
export function interpolateTemplate(ap: Autopilot): string {
  const tmpl = ap.issueTitleTemplate ?? ap.title;
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const time = now.toISOString().slice(11, 16); // HH:MM UTC
  const datetime = now.toISOString();
  return tmpl
    .replaceAll("{{date}}", date)
    .replaceAll("{{time}}", time)
    .replaceAll("{{datetime}}", datetime);
}

/**
 * Append the autopilot run footer to the description so the agent knows it's
 * an autopilot-spawned issue.
 */
export function buildIssueDescription(ap: Autopilot): string {
  const now = `${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC`;
  const note = `\n\n---\n*Autopilot run triggered at ${now}. After starting work, rename this issue to accurately reflect what you are doing.*`;
  return (ap.description ?? "") + note;
}

/**
 * Called from the issues route when an issue's status hits a terminal state.
 * If the issue was spawned by an autopilot, finalize the linked active run.
 *
 * Terminal status mapping:
 *   done | in_review  → run.status = completed
 *   cancelled | blocked → run.status = failed (failure_reason = `issue {status}`)
 */
export async function syncRunFromIssue(issue: Issue): Promise<void> {
  if (issue.originType !== "autopilot") return;
  const run = await db.query.autopilotRuns.findFirst({
    where: and(
      eq(autopilotRuns.issueId, issue.id),
      inArray(autopilotRuns.status, ["issue_created", "running"]),
    ),
  });
  if (!run) return;

  if (issue.status === "done" || issue.status === "in_review") {
    await db
      .update(autopilotRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(autopilotRuns.id, run.id));
    broadcastWorkspace(issue.workspaceId, {
      type: "autopilot.run.done",
      data: {
        runId: run.id,
        autopilotId: run.autopilotId,
        workspaceId: issue.workspaceId,
        status: "completed",
      },
    });
  } else if (issue.status === "cancelled" || issue.status === "blocked") {
    await db
      .update(autopilotRuns)
      .set({
        status: "failed",
        failureReason: `issue ${issue.status}`,
        completedAt: new Date(),
      })
      .where(eq(autopilotRuns.id, run.id));
    broadcastWorkspace(issue.workspaceId, {
      type: "autopilot.run.done",
      data: {
        runId: run.id,
        autopilotId: run.autopilotId,
        workspaceId: issue.workspaceId,
        status: "failed",
      },
    });
  }
}

/**
 * Run-only dispatch: enqueue an agent task that points back at the run, with
 * no issue. Used for one-shot agent work (cron sweeps, webhook reactions)
 * where the run history IS the artifact, not an issue thread.
 *
 * The task is created with status='queued', and the run starts in 'running'.
 * The daemon's start/complete/fail hook will move
 * the run through running → completed/failed via syncRunFromTask.
 */
async function dispatchRunOnly(ap: Autopilot, opts: DispatchOptions): Promise<Run> {
  const [pending] = await db
    .insert(autopilotRuns)
    .values({
      autopilotId: ap.id,
      triggerId: opts.triggerId ?? null,
      source: opts.source,
      status: "running",
      triggerPayload: opts.triggerPayload ?? null,
    })
    .returning();
  if (!pending) throw new Error("dispatchRunOnly: failed to insert run");

  try {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, ap.assigneeId) });
    if (!agent) throw new Error(`agent ${ap.assigneeId} not found`);
    if (agent.archivedAt) throw new Error("agent is archived");
    if (!agent.runtimeId) throw new Error("agent has no runtime");

    const [task] = await db
      .insert(agentTaskQueue)
      .values({
        workspaceId: ap.workspaceId,
        agentId: agent.id,
        runtimeId: agent.runtimeId,
        autopilotRunId: pending.id,
        originType: "autopilot",
        originId: ap.id,
        triggerSummary: truncate(`autopilot: ${ap.title}`, 200),
      })
      .returning();
    if (!task) throw new Error("dispatchRunOnly: insert task returned no row");

    // Bump autopilot.last_run_at.
    await db
      .update(autopilots)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(autopilots.id, ap.id));

    // Link task→run.
    const [updated] = await db
      .update(autopilotRuns)
      .set({ taskId: task.id })
      .where(eq(autopilotRuns.id, pending.id))
      .returning();

    broadcastWorkspace(ap.workspaceId, {
      type: "task.queued",
      data: {
        id: task.id,
        agentId: task.agentId,
        runtimeId: task.runtimeId,
        issueId: null,
        workspaceId: task.workspaceId,
      },
    });
    daemonHub.notifyTaskAvailable(agent.runtimeId, task.id);

    broadcastWorkspace(ap.workspaceId, {
      type: "autopilot.run.start",
      data: {
        runId: pending.id,
        autopilotId: ap.id,
        workspaceId: ap.workspaceId,
      },
    });

    return updated ?? pending;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const [failed] = await db
      .update(autopilotRuns)
      .set({ status: "failed", failureReason: reason, completedAt: new Date() })
      .where(eq(autopilotRuns.id, pending.id))
      .returning();
    return failed ?? pending;
  }
}

/**
 * Called from the daemon `/tasks/:id/complete` and `/tasks/:id/fail`
 * handlers when the task is linked to an autopilot run.
 *
 * For run_only runs this is the terminal hook. For create_issue runs the
 * run is closed by syncRunFromIssue (issue state machine) — but we still
 * record a failure reason here if the task itself blew up before the
 * agent could update the issue.
 */
export async function syncRunFromTask(task: Task): Promise<void> {
  if (!task.autopilotRunId) return;
  const run = await db.query.autopilotRuns.findFirst({
    where: eq(autopilotRuns.id, task.autopilotRunId),
  });
  if (!run) return;
  // Don't reopen terminal runs.
  if (run.status === "completed" || run.status === "failed") return;

  const ap = await db.query.autopilots.findFirst({
    where: eq(autopilots.id, run.autopilotId),
  });
  if (!ap) return;

  // For create_issue runs, the issue state machine owns the run lifecycle.
  // syncRunFromIssue runs when the issue transitions; the task hook here
  // only kicks in if the task failed before the issue was touched, so the
  // run doesn't dangle in issue_created forever.
  if (ap.executionMode === "create_issue") {
    if (task.status !== "failed" && task.status !== "cancelled") return;
    const [updated] = await db
      .update(autopilotRuns)
      .set({
        status: "failed",
        failureReason: task.error ?? `task ${task.status}`,
        completedAt: new Date(),
      })
      .where(eq(autopilotRuns.id, run.id))
      .returning();
    if (updated) {
      broadcastWorkspace(ap.workspaceId, {
        type: "autopilot.run.done",
        data: {
          runId: updated.id,
          autopilotId: ap.id,
          workspaceId: ap.workspaceId,
          status: "failed",
        },
      });
    }
    return;
  }

  // run_only: mirror task lifecycle directly into the run.
  if (task.status === "completed") {
    const [updated] = await db
      .update(autopilotRuns)
      .set({
        status: "completed",
        result: (task.result as unknown) ?? null,
        completedAt: new Date(),
      })
      .where(eq(autopilotRuns.id, run.id))
      .returning();
    if (updated) {
      broadcastWorkspace(ap.workspaceId, {
        type: "autopilot.run.done",
        data: {
          runId: updated.id,
          autopilotId: ap.id,
          workspaceId: ap.workspaceId,
          status: "completed",
        },
      });
    }
  } else if (task.status === "failed" || task.status === "cancelled") {
    const [updated] = await db
      .update(autopilotRuns)
      .set({
        status: "failed",
        failureReason: task.error ?? `task ${task.status}`,
        completedAt: new Date(),
      })
      .where(eq(autopilotRuns.id, run.id))
      .returning();
    if (updated) {
      broadcastWorkspace(ap.workspaceId, {
        type: "autopilot.run.done",
        data: {
          runId: updated.id,
          autopilotId: ap.id,
          workspaceId: ap.workspaceId,
          status: "failed",
        },
      });
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

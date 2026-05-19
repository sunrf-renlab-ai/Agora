import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { log } from "../lib/log";
import { broadcastWorkspace } from "../lib/ws-hub";

const TICK_INTERVAL_MS = 60_000;
const DEFAULT_RUNTIME_STALE_MS = 90_000; // 3 missed daemon heartbeats (daemon ticks every 30s)
const DEFAULT_TASK_STALE_MS = 5 * 60_000; // dispatched/running with no heartbeat for 5m → assume runtime is gone

let timer: ReturnType<typeof setInterval> | null = null;

export interface TickResult {
  runtimesMarkedOffline: number;
  tasksFailed: number;
  tasksReconciled: number;
}

export interface TickOptions {
  /** Override the runtime stale threshold in milliseconds. Defaults to 90s. */
  runtimeStaleMs?: number;
  /** Override the task stale threshold in milliseconds. Defaults to 5 minutes. */
  taskStaleMs?: number;
}

function resolveRuntimeStaleMs(opts?: TickOptions): number {
  if (opts?.runtimeStaleMs !== undefined) return opts.runtimeStaleMs;
  const env = process.env.RUNTIME_STALE_MS;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_RUNTIME_STALE_MS;
}

function resolveTaskStaleMs(opts?: TickOptions): number {
  if (opts?.taskStaleMs !== undefined) return opts.taskStaleMs;
  const env = process.env.TASK_STALE_MS;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_TASK_STALE_MS;
}

/** Start the in-process runtime monitor. Idempotent — second call is a no-op. */
export function startRuntimeMonitor(): void {
  if (timer) return;
  log.info("monitor.started", { tickMs: TICK_INTERVAL_MS });
  timer = setInterval(() => {
    tickRuntimeMonitor().catch((err) => {
      log.warn("monitor.tick.failed", { err: (err as Error).message });
    });
  }, TICK_INTERVAL_MS);
}

/** Stop the runtime monitor. Used by tests and graceful shutdown. */
export function stopRuntimeMonitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * One monitor tick — runs both sweeps and returns counts.
 *
 * Sweep 1: runtimes with stale heartbeats are marked `online = false` and
 * `runtime.offline` is broadcast per affected workspace.
 *
 * Sweep 2: tasks in `dispatched` or `running` whose most-recent activity
 * (heartbeat → started → dispatched, in that order) is older than the task
 * stale threshold are failed with `failure_reason = 'runtime_recovery'` and
 * `task.failed` is broadcast per affected workspace.
 */
export async function tickRuntimeMonitor(opts?: TickOptions): Promise<TickResult> {
  const runtimeStaleMs = resolveRuntimeStaleMs(opts);
  const taskStaleMs = resolveTaskStaleMs(opts);
  const runtimesMarkedOffline = await sweepStaleRuntimes(runtimeStaleMs);
  const tasksFailed = await sweepStaleTasks(taskStaleMs);
  const tasksReconciled = await sweepIssueStateMismatch();
  if (runtimesMarkedOffline + tasksFailed + tasksReconciled > 0) {
    log.info("monitor.tick", { runtimesMarkedOffline, tasksFailed, tasksReconciled });
  }
  return { runtimesMarkedOffline, tasksFailed, tasksReconciled };
}

async function sweepStaleRuntimes(staleMs: number): Promise<number> {
  const rows = await db.execute(sql`
    UPDATE runtime
    SET online = false, updated_at = now()
    WHERE online = true
      AND last_heartbeat_at IS NOT NULL
      AND last_heartbeat_at < now() - (${staleMs} / 1000.0) * interval '1 second'
    RETURNING id, workspace_id
  `);
  const list = rows as unknown as Array<{ id: string; workspace_id: string }>;
  for (const r of list) {
    broadcastWorkspace(r.workspace_id, {
      type: "runtime.offline",
      data: { id: r.id, workspaceId: r.workspace_id },
    });
  }
  return list.length;
}

async function sweepStaleTasks(staleMs: number): Promise<number> {
  const rows = await db.execute(sql`
    UPDATE agent_task_queue
    SET status = 'failed',
        completed_at = now(),
        failure_reason = 'runtime_recovery',
        error_kind = COALESCE(error_kind, 'runtime_recovery'),
        error = COALESCE(error, 'task heartbeat timed out — runtime presumed offline'),
        updated_at = now()
    WHERE status IN ('dispatched', 'running')
      AND COALESCE(last_heartbeat_at, started_at, dispatched_at)
          < now() - (${staleMs} / 1000.0) * interval '1 second'
    RETURNING id, workspace_id, agent_id, issue_id
  `);
  const list = rows as unknown as Array<{
    id: string;
    workspace_id: string;
    agent_id: string;
    issue_id: string | null;
  }>;
  for (const t of list) {
    broadcastWorkspace(t.workspace_id, {
      type: "task.failed",
      data: { id: t.id, issueId: t.issue_id, reason: "runtime_recovery" },
    });
  }
  return list.length;
}

/**
 * Active reconciliation. The push model (WS hub) is
 * fast for the happy path, but we also need a pull-side check so that an
 * issue moved to a terminal state in the DB (closed by a human, archived,
 * cancelled) doesn't leave its task running forever burning CLI budget on
 * work no one wants anymore.
 *
 * What this sweep does:
 *  1. Find any task in dispatched/running whose linked issue.status is now
 *     `done`, `cancelled`, or `blocked`.
 *  2. Mark the task `cancelled` with `error_kind=canceled_by_reconciliation`.
 *  3. Broadcast `task.failed` so the workspace UI updates.
 *
 * The actual agent subprocess on the daemon keeps running until it exits
 * naturally. When it tries to call /complete or /fail it gets a 404 (the
 * task is no longer in dispatched/running) and the daemon logs + moves on.
 * Wasting one more turn of compute is an acceptable price; the source of
 * truth in the DB is now consistent.
 */
async function sweepIssueStateMismatch(): Promise<number> {
  const rows = await db.execute(sql`
    UPDATE agent_task_queue atq
    SET status = 'cancelled',
        completed_at = now(),
        failure_reason = 'agent_error',
        error_kind = 'canceled_by_reconciliation',
        error = COALESCE(error,
          'issue moved to a terminal state while task was running — reconciler cancelled it'),
        updated_at = now()
    FROM issue i
    WHERE atq.issue_id = i.id
      AND atq.status IN ('dispatched', 'running')
      AND i.status IN ('done', 'cancelled', 'blocked')
    RETURNING atq.id, atq.workspace_id, atq.issue_id
  `);
  const list = rows as unknown as Array<{
    id: string;
    workspace_id: string;
    issue_id: string | null;
  }>;
  for (const t of list) {
    broadcastWorkspace(t.workspace_id, {
      type: "task.failed",
      data: { id: t.id, issueId: t.issue_id, reason: "canceled_by_reconciliation" },
    });
  }
  return list.length;
}

// Backwards-compatible aliases used elsewhere in the plan (e.g. phase9-flows test).
export const startMonitor = startRuntimeMonitor;
export const stopMonitor = stopRuntimeMonitor;
export const tickMonitor = tickRuntimeMonitor;

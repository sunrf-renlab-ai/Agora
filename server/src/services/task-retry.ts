import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { agentTaskQueue } from "../db/schema/index";
import { broadcastWorkspace } from "../lib/ws-hub";

type ErrorKind =
  | "prompt_render_error"
  | "workspace_create_failed"
  | "agent_spawn_failed"
  | "turn_timeout"
  | "stall_timeout"
  | "agent_crashed"
  | "tracker_error"
  | "canceled_by_reconciliation"
  | "runtime_recovery"
  | "unknown";

/**
 * Failure-driven retries use exponential backoff capped at
 * `MAX_BACKOFF_MS` (5 min by default). Continuation retries — where the
 * agent finished its turn cleanly but the issue is still active — use a
 * flat short delay.
 */
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const CONTINUATION_DELAY_MS = 1_000;

export function backoffDelayMs(attempt: number): number {
  if (attempt < 1) return 0;
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

/**
 * Error kinds that are considered transient and worth retrying. Deterministic
 * failures (prompt_render_error, workspace_create_failed, canceled_by_reconciliation)
 * are NOT retried because the next attempt would just hit the same bug.
 */
export const RETRYABLE_ERROR_KINDS = new Set([
  "turn_timeout",
  "stall_timeout",
  "agent_crashed",
  "agent_spawn_failed",
  "tracker_error",
]);

export type RetryDecision =
  | { kind: "retry"; nextAttempt: number; delayMs: number; dueAt: Date }
  | { kind: "skip"; reason: string };

/**
 * Decide whether a failed task should be requeued for another attempt.
 * Pure function — no DB access — so it's trivially testable.
 */
export function decideRetry(args: {
  attempt: number;
  maxAttempts: number;
  errorKind: string | null | undefined;
  continuation?: boolean;
}): RetryDecision {
  if (args.attempt >= args.maxAttempts) {
    return { kind: "skip", reason: "max_attempts_reached" };
  }
  if (args.continuation) {
    const dueAt = new Date(Date.now() + CONTINUATION_DELAY_MS);
    return {
      kind: "retry",
      nextAttempt: args.attempt + 1,
      delayMs: CONTINUATION_DELAY_MS,
      dueAt,
    };
  }
  if (!args.errorKind || !RETRYABLE_ERROR_KINDS.has(args.errorKind)) {
    return { kind: "skip", reason: "non_retryable_error_kind" };
  }
  const delayMs = backoffDelayMs(args.attempt);
  return {
    kind: "retry",
    nextAttempt: args.attempt + 1,
    delayMs,
    dueAt: new Date(Date.now() + delayMs),
  };
}

/**
 * Requeue a previously-failed task for another attempt. Caller must have
 * already inspected `decideRetry` and gotten a `retry` decision; this just
 * mutates the row.
 *
 * Note: re-uses the SAME row rather than inserting a new one so the
 * task-message timeline + autopilot_run linkage stays continuous across
 * attempts. `claimNextTaskForRuntime` honors `next_attempt_at`, so the
 * row sits queued until the backoff window expires.
 */
export async function requeueForRetry(args: {
  taskId: string;
  nextAttempt: number;
  dueAt: Date;
  errorKind: ErrorKind;
}): Promise<void> {
  const [t] = await db
    .update(agentTaskQueue)
    .set({
      status: "queued",
      attempt: args.nextAttempt,
      nextAttemptAt: args.dueAt,
      errorKind: args.errorKind,
      // Clear runner-side fields from the prior attempt so the next claim
      // dispatches cleanly.
      dispatchedAt: null,
      startedAt: null,
      completedAt: null,
      lastHeartbeatAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(agentTaskQueue.id, args.taskId), inArray(agentTaskQueue.status, ["failed"])))
    .returning();
  if (!t) return;
  broadcastWorkspace(t.workspaceId, {
    type: "task.failed",
    data: { id: t.id, issueId: t.issueId, reason: "retry_scheduled" },
  });
}

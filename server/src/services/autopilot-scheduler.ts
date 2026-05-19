import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { autopilotTriggers, autopilots } from "../db/schema/index";
import { computeNextRun } from "../lib/cron";
import { dispatchAutopilot } from "./autopilot";

const TICK_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the in-process scheduler. Idempotent — second call is a no-op. */
export function startScheduler(): void {
  if (timer) return;
  // Recover any triggers stranded with next_run_at = NULL from a prior crash.
  recoverLostTriggers().catch((err) => {
    console.warn("autopilot scheduler: recoverLostTriggers failed", err);
  });
  timer = setInterval(() => {
    tickScheduler().catch((err) => {
      console.warn("autopilot scheduler: tick failed", err);
    });
  }, TICK_INTERVAL_MS);
}

/** Stop the scheduler. Used by tests. */
export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * One scheduler tick — atomically claims due triggers, dispatches each, advances next_run_at.
 * Returns the number of triggers dispatched.
 *
 * Atomicity: the SELECT-and-NULL UPDATE in a single statement guarantees that
 * no other process (or future tick) can grab the same trigger between read and
 * claim. After dispatch we recompute next_run_at via cron-parser; if the
 * process crashes between claim and advance, recoverLostTriggers fixes it on
 * next startup.
 */
export async function tickScheduler(): Promise<number> {
  const claimed = await db.execute(sql`
    UPDATE autopilot_trigger t
    SET next_run_at = NULL
    FROM autopilot a
    WHERE t.autopilot_id = a.id
      AND t.kind = 'schedule'
      AND t.enabled = true
      AND t.next_run_at IS NOT NULL
      AND t.next_run_at <= now()
      AND a.status = 'active'
    RETURNING t.id, t.autopilot_id, t.cron_expression, t.timezone
  `);
  const rows = claimed as unknown as Array<{
    id: string;
    autopilot_id: string;
    cron_expression: string | null;
    timezone: string | null;
  }>;
  if (rows.length === 0) return 0;

  let dispatched = 0;
  for (const row of rows) {
    try {
      const ap = await db.query.autopilots.findFirst({
        where: eq(autopilots.id, row.autopilot_id),
      });
      if (!ap) {
        console.warn("autopilot scheduler: autopilot vanished", { triggerId: row.id });
        continue;
      }
      await dispatchAutopilot(ap, { source: "schedule", triggerId: row.id });
      dispatched++;
      await advanceTrigger(row.id, row.cron_expression, row.timezone);
    } catch (err) {
      console.warn("autopilot scheduler: dispatch failed", { triggerId: row.id, err });
      // Advance next_run_at anyway so we don't tight-loop on a broken autopilot.
      await advanceTrigger(row.id, row.cron_expression, row.timezone).catch(() => {});
    }
  }
  return dispatched;
}

async function advanceTrigger(
  triggerId: string,
  cronExpression: string | null,
  timezone: string | null,
): Promise<void> {
  if (!cronExpression) return;
  const tz = timezone ?? "UTC";
  let next: Date;
  try {
    next = computeNextRun(cronExpression, tz);
  } catch (err) {
    console.warn("autopilot scheduler: computeNextRun failed", { triggerId, err });
    return;
  }
  await db
    .update(autopilotTriggers)
    .set({ nextRunAt: next, lastFiredAt: new Date(), updatedAt: new Date() })
    .where(eq(autopilotTriggers.id, triggerId));
}

/**
 * Find triggers stranded with next_run_at = NULL (typically a crash between
 * claim and advance) and recompute.
 */
export async function recoverLostTriggers(): Promise<number> {
  const rows = await db.execute(sql`
    SELECT t.id, t.cron_expression, t.timezone
    FROM autopilot_trigger t
    JOIN autopilot a ON t.autopilot_id = a.id
    WHERE t.kind = 'schedule'
      AND t.enabled = true
      AND t.next_run_at IS NULL
      AND t.cron_expression IS NOT NULL
      AND a.status = 'active'
  `);
  const list = rows as unknown as Array<{
    id: string;
    cron_expression: string;
    timezone: string | null;
  }>;
  for (const t of list) {
    await advanceTrigger(t.id, t.cron_expression, t.timezone);
  }
  return list.length;
}

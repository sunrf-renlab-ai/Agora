-- Wave 1 schema additions for symphony-borrow:
--   * agent.concurrency_by_state — per-issue-state concurrency cap (jsonb map)
--   * agent_task_queue.next_attempt_at — for exponential-backoff scheduler
--   * agent_task_queue.error_kind — structured error taxonomy
--   * agent_task_queue.phase — fine-grain run lifecycle phase
--   * agent_task_queue.usage — token/cost usage payload from CLI
--   * idx_task_next_attempt — supports the retry scheduler's claim query
--
-- (drizzle-kit also tried to re-emit `cli_pair_code` because the prior
--  hand-written migration `20260513000000_cli_pair_code.sql` was never
--  registered in `_journal.json`; that schema lives in prod already, so the
--  duplicate CREATE TABLE was stripped from this migration to keep it
--  idempotent.)
ALTER TABLE "agent" ADD COLUMN "concurrency_by_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD COLUMN "error_kind" text;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD COLUMN "usage" jsonb;--> statement-breakpoint
CREATE INDEX "idx_task_next_attempt" ON "agent_task_queue" USING btree ("status","next_attempt_at");

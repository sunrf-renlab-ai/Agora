ALTER TABLE "agent_runtime" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "agent_runtime" CASCADE;--> statement-breakpoint
DROP INDEX "idx_task_issue";--> statement-breakpoint
DROP INDEX "idx_task_claim_candidate";--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "description" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "instructions" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "instructions" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "mcp_config" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "mcp_config" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ALTER COLUMN "issue_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ALTER COLUMN "runtime_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ALTER COLUMN "max_attempts" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ALTER COLUMN "force_fresh_session" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ALTER COLUMN "force_fresh_session" SET DATA TYPE integer USING ("force_fresh_session"::int);--> statement-breakpoint
ALTER TABLE "agent_task_queue" ALTER COLUMN "force_fresh_session" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "runtime_id" uuid;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "runtime_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "runtime" ADD COLUMN "member_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime" ADD COLUMN "daemon_version" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime" ADD COLUMN "detected_clis" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD COLUMN "chat_session_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD COLUMN "autopilot_run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD COLUMN "quick_create_prompt" text;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_runtime_id_runtime_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "public"."runtime"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_archived_by_user_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime" ADD CONSTRAINT "runtime_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD CONSTRAINT "agent_task_queue_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD CONSTRAINT "agent_task_queue_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD CONSTRAINT "agent_task_queue_runtime_id_runtime_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "public"."runtime"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_queue" ADD CONSTRAINT "agent_task_queue_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_workspace_active" ON "agent" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_agent_owner" ON "agent" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_workspace" ON "runtime" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_task_runtime_status" ON "agent_task_queue" USING btree ("runtime_id","status");--> statement-breakpoint
CREATE INDEX "idx_task_claim_candidate" ON "agent_task_queue" USING btree ("runtime_id","agent_id","priority","created_at");--> statement-breakpoint
ALTER TABLE "agent" DROP COLUMN "archived";--> statement-breakpoint
ALTER TABLE "runtime" ADD CONSTRAINT "uq_runtime_member_name" UNIQUE("workspace_id","member_id","name");--> statement-breakpoint
DROP INDEX IF EXISTS "idx_task_claim_candidate";--> statement-breakpoint
CREATE INDEX "idx_task_claim_candidate" ON "agent_task_queue"
  USING btree ("runtime_id","agent_id","priority","created_at")
  WHERE status = 'queued';--> statement-breakpoint
DROP INDEX IF EXISTS "idx_agent_workspace_active";--> statement-breakpoint
CREATE INDEX "idx_agent_workspace_active" ON "agent" ("workspace_id")
  WHERE archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_one_active_task_per_issue" ON "agent_task_queue" ("issue_id")
  WHERE issue_id IS NOT NULL AND status IN ('queued','dispatched','running');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_one_active_task_per_chat" ON "agent_task_queue" ("chat_session_id")
  WHERE chat_session_id IS NOT NULL AND status IN ('queued','dispatched','running');
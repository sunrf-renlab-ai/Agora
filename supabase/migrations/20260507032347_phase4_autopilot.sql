ALTER TABLE "autopilot_trigger" DROP CONSTRAINT "autopilot_trigger_webhook_token_unique";--> statement-breakpoint
ALTER TABLE "autopilot_run" ALTER COLUMN "status" SET DEFAULT 'issue_created';--> statement-breakpoint
ALTER TABLE "autopilot_run" ADD COLUMN "source" text NOT NULL;--> statement-breakpoint
ALTER TABLE "autopilot_run" ADD COLUMN "triggered_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "autopilot_run" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "autopilot_run" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "autopilot_run" ADD COLUMN "trigger_payload" jsonb;--> statement-breakpoint
ALTER TABLE "autopilot_run" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "autopilot_trigger" ADD COLUMN "kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "autopilot_trigger" ADD COLUMN "cron_expression" text;--> statement-breakpoint
ALTER TABLE "autopilot_trigger" ADD COLUMN "timezone" text DEFAULT 'UTC';--> statement-breakpoint
ALTER TABLE "autopilot_trigger" ADD COLUMN "webhook_token_hash" text;--> statement-breakpoint
ALTER TABLE "autopilot_trigger" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "autopilot_trigger" ADD COLUMN "last_fired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "autopilot" ADD COLUMN "title" text NOT NULL;--> statement-breakpoint
ALTER TABLE "autopilot" ADD COLUMN "assignee_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "autopilot" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "autopilot" ADD COLUMN "execution_mode" text DEFAULT 'create_issue' NOT NULL;--> statement-breakpoint
ALTER TABLE "autopilot" ADD COLUMN "issue_title_template" text;--> statement-breakpoint
ALTER TABLE "autopilot" ADD COLUMN "created_by_kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "autopilot" ADD COLUMN "created_by_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "autopilot" ADD COLUMN "last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "autopilot_run" ADD CONSTRAINT "autopilot_run_autopilot_id_autopilot_id_fk" FOREIGN KEY ("autopilot_id") REFERENCES "public"."autopilot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_run" ADD CONSTRAINT "autopilot_run_trigger_id_autopilot_trigger_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."autopilot_trigger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_run" ADD CONSTRAINT "autopilot_run_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_run" ADD CONSTRAINT "autopilot_run_task_id_agent_task_queue_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_task_queue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_trigger" ADD CONSTRAINT "autopilot_trigger_autopilot_id_autopilot_id_fk" FOREIGN KEY ("autopilot_id") REFERENCES "public"."autopilot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot" ADD CONSTRAINT "autopilot_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot" ADD CONSTRAINT "autopilot_assignee_id_agent_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_autopilot_run_autopilot" ON "autopilot_run" USING btree ("autopilot_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_autopilot_run_issue" ON "autopilot_run" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_autopilot_trigger_autopilot" ON "autopilot_trigger" USING btree ("autopilot_id");--> statement-breakpoint
CREATE INDEX "idx_autopilot_trigger_next_run" ON "autopilot_trigger" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "idx_autopilot_workspace" ON "autopilot" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_autopilot_assignee" ON "autopilot" USING btree ("assignee_id");--> statement-breakpoint
ALTER TABLE "autopilot_run" DROP COLUMN "error";--> statement-breakpoint
ALTER TABLE "autopilot_run" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "autopilot_trigger" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "autopilot_trigger" DROP COLUMN "config";--> statement-breakpoint
ALTER TABLE "autopilot_trigger" DROP COLUMN "webhook_token";--> statement-breakpoint
ALTER TABLE "autopilot" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "autopilot" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "autopilot" DROP COLUMN "prompt";--> statement-breakpoint
ALTER TABLE "autopilot" DROP COLUMN "mode";--> statement-breakpoint
ALTER TABLE "autopilot" DROP COLUMN "concurrency_strategy";--> statement-breakpoint
ALTER TABLE "autopilot" DROP COLUMN "enabled";--> statement-breakpoint
ALTER TABLE "autopilot_trigger" ADD CONSTRAINT "autopilot_trigger_webhook_token_hash_unique" UNIQUE("webhook_token_hash");
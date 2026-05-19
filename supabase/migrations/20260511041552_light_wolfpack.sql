CREATE TABLE "task_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_message" ADD CONSTRAINT "task_message_task_id_agent_task_queue_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_task_queue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_message" ADD CONSTRAINT "task_message_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_message_task_seq_idx" ON "task_message" USING btree ("task_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "task_message_task_seq_unique" ON "task_message" USING btree ("task_id","seq");
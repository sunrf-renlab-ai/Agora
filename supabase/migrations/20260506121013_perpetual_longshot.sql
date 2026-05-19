ALTER TABLE "user" ALTER COLUMN "onboarding_questionnaire" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runtime" ADD CONSTRAINT "agent_runtime_agent_id_runtime_id_pk" PRIMARY KEY("agent_id","runtime_id");--> statement-breakpoint
ALTER TABLE "issue_to_label" ADD CONSTRAINT "issue_to_label_issue_id_label_id_pk" PRIMARY KEY("issue_id","label_id");--> statement-breakpoint
CREATE INDEX "idx_member_user" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_issue_subscriber" ON "issue_subscriber" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_comment_issue" ON "comment" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_task_issue" ON "agent_task_queue" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_inbox_recipient" ON "inbox_item" USING btree ("recipient_id","read","archived");--> statement-breakpoint
CREATE INDEX "idx_activity_workspace" ON "activity_log" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "uq_issue_number" UNIQUE("workspace_id","number");
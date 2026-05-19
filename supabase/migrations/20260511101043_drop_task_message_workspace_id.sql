ALTER TABLE "task_message" DROP CONSTRAINT "task_message_workspace_id_workspace_id_fk";
--> statement-breakpoint
ALTER TABLE "task_message" DROP COLUMN "workspace_id";
ALTER TABLE "user" ADD COLUMN "notification_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "kind" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_kind_check" CHECK ("kind" IN ('general','bug','feature'));
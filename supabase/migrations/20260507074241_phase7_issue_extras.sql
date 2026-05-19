-- Phase 7: drop any pre-existing 'blocked_by' rows (Phase 2 scaffold allowed them).
DELETE FROM "issue_dependency" WHERE "type" = 'blocked_by';--> statement-breakpoint
ALTER TABLE "issue_dependency" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_dependency" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_dependency" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_label" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_label" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_to_label" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_to_label" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_reaction" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_dep_issue" ON "issue_dependency" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_dep_target" ON "issue_dependency" USING btree ("depends_on_issue_id");--> statement-breakpoint
CREATE INDEX "idx_issue_to_label_workspace" ON "issue_to_label" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_comment_reaction_comment" ON "comment_reaction" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "idx_issue_reaction_issue" ON "issue_reaction" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_attachment_owner" ON "attachment" USING btree ("owner_kind","owner_id");--> statement-breakpoint
ALTER TABLE "issue_dependency" ADD CONSTRAINT "uq_dep_pair_type" UNIQUE("issue_id","depends_on_issue_id","type");--> statement-breakpoint
ALTER TABLE "issue_label" ADD CONSTRAINT "uq_label_workspace_name" UNIQUE("workspace_id","name");--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "uq_comment_reaction" UNIQUE("comment_id","actor_kind","actor_id","emoji");--> statement-breakpoint
ALTER TABLE "issue_reaction" ADD CONSTRAINT "uq_issue_reaction" UNIQUE("issue_id","actor_kind","actor_id","emoji");--> statement-breakpoint
-- Create private storage bucket for attachments (idempotent). Wrap in a
-- DO block so the migration still applies on a vanilla Postgres where the
-- Supabase storage extension isn't present — used by the CI gate that
-- replays migrations against a stock postgres:17 service container.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('attachments', 'attachments', false)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN undefined_column OR undefined_table OR invalid_schema_name THEN
    RAISE NOTICE 'storage.buckets not available — skipping attachment bucket setup';
END $$;
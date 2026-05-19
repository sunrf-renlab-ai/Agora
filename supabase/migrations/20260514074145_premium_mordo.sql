-- Email becomes nullable: link-only invitations don't bind a recipient.
-- Existing email-bound rows are unaffected.
ALTER TABLE "member_invitation" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
-- Idempotent re-add for environments that already applied the raw SQL
-- migration `20260514130000_local_skill_import_visibility.sql` out-of-band
-- (prod was patched manually before the journal entry landed). Without
-- IF NOT EXISTS this would 42701 in those envs.
ALTER TABLE "runtime_local_skill_import_request" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'workspace' NOT NULL;

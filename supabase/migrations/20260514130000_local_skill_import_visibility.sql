-- Add user-chosen visibility to the local-skill import request so the
-- daemon callback can finalize the skill row at the chosen scope
-- atomically (instead of two roundtrips: import-as-workspace then PATCH).
-- Allowed values are workspace | public; private isn't surfaced here
-- because importing into "private" defeats the whole point of promoting.
ALTER TABLE "runtime_local_skill_import_request"
  ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'workspace';

-- Defense-in-depth: pin the enum at the DB layer too. drizzle text-enum
-- columns enforce in TS, but a direct SQL insert from the wrong code
-- path would otherwise allow garbage values to land.
-- Idempotent constraint add — prod was patched manually before the
-- journal entry landed, and dev DBs that imported the column out-of-band
-- would otherwise trip 42710 (constraint already exists) on next migrate.
DO $$
BEGIN
  ALTER TABLE "runtime_local_skill_import_request"
    ADD CONSTRAINT "runtime_local_skill_import_visibility_check"
    CHECK ("visibility" IN ('workspace', 'public'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

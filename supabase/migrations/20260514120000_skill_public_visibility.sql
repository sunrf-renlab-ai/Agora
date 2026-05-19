-- No-op against the schema as-is (visibility is plain text), but we ship
-- this file so:
--   1. CI's migration replay stays in sync with the drizzle types
--   2. Any future check constraint or pgRoute introspection sees "public"
--      as a valid value rather than rejecting it.
-- The drizzle enum is enforced at the application layer, so adding the
-- value to the union in skills.ts is what actually changes behavior. We
-- still SET this comment so the migration is non-empty and auditable.
COMMENT ON COLUMN "skill"."visibility" IS 'workspace | private | public';

#!/usr/bin/env bash
# Verify agora's tables + RLS policies exist on a Supabase project via
# the Management API. Run after migrations to confirm they actually
# landed.
#
# Usage:
#   SUPABASE_PAT=sbp_… PROJECT_REF=<ref> ./supabase-verify-tables.sh

set -euo pipefail

: "${SUPABASE_PAT:?SUPABASE_PAT not set}"
: "${PROJECT_REF:?PROJECT_REF not set}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (brew install jq)" >&2
  exit 1
fi

API="https://api.supabase.com/v1/projects/$PROJECT_REF/database/query"

run_query() {
  local q="$1"
  local body
  body=$(jq -nc --arg q "$q" '{query: $q}')
  curl -sS \
    -X POST "$API" \
    -H "Authorization: Bearer $SUPABASE_PAT" \
    -H "Content-Type: application/json" \
    -d "$body"
}

# Tables drizzle creates for agora (see server/src/db/schema/*.ts). If
# you add or rename a table, update this list.
REQUIRED_TABLES=(
  user
  workspace
  member
  member_invitation
  agent
  runtime
  issue
  issue_label
  issue_to_label
  issue_dependency
  issue_subscriber
  issue_reaction
  comment
  comment_reaction
  agent_task_queue
  task_message
  autopilot
  autopilot_trigger
  autopilot_run
  chat_session
  chat_message
  project
  project_resource
  skill
  skill_file
  agent_skill
  runtime_local_skill_list_request
  runtime_local_skill_import_request
  inbox_item
  notification_preference
  activity_log
  attachment
  pin
  personal_access_token
  feedback
)

echo ">> Public tables present on $PROJECT_REF:"
TABLES_JSON=$(run_query "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")
echo "$TABLES_JSON" | jq -r '.[].tablename' || true

echo ""
echo ">> Checking required tables..."
PRESENT=$(echo "$TABLES_JSON" | jq -r '.[].tablename')
MISSING=0
for t in "${REQUIRED_TABLES[@]}"; do
  if printf '%s\n' "$PRESENT" | grep -qx "$t"; then
    printf "  \033[32mOK\033[0m  %s\n" "$t"
  else
    printf "  \033[31mMISSING\033[0m %s\n" "$t"
    MISSING=$((MISSING + 1))
  fi
done

echo ""
echo ">> RLS policies on public schema:"
run_query "SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;" \
  | jq -r '.[] | "  \(.tablename).\(.policyname) (\(.cmd))"' \
  || echo "  (none — agora authenticates server-side with the service-role key, so RLS may be intentionally absent)"

echo ""
if [[ "$MISSING" -gt 0 ]]; then
  echo ">> $MISSING required table(s) missing. Re-run migrations or check the schema list in this script."
  exit 1
fi
echo ">> All ${#REQUIRED_TABLES[@]} required tables present."

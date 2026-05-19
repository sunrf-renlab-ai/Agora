#!/usr/bin/env bash
# Iterate agora's migrations in filename order and POST each one through
# the Supabase Management API. Use when Clash/Mihomo/corporate firewall
# blocks direct TCP to db.<ref>.supabase.co:5432.
#
# Usage:
#   SUPABASE_PAT=sbp_… PROJECT_REF=<ref> \
#     scripts/zero-cost-deploy/push-all-migrations.sh
#
# Files are taken from supabase/migrations/*.sql (drizzle-kit's output
# naming sorts lexicographically by timestamp, which matches creation
# order).

set -euo pipefail

: "${SUPABASE_PAT:?SUPABASE_PAT not set — get one at https://supabase.com/dashboard/account/tokens}"
: "${PROJECT_REF:?PROJECT_REF not set — find it in your project URL}"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$REPO_ROOT/supabase/migrations"
PUSH="$(dirname "$0")/supabase-push-migration.sh"

if [[ ! -d "$MIG_DIR" ]]; then
  echo "no such dir: $MIG_DIR" >&2
  exit 2
fi

shopt -s nullglob
FILES=("$MIG_DIR"/*.sql)
shopt -u nullglob

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "no .sql files under $MIG_DIR" >&2
  exit 2
fi

# Defensive sort — globs are already alpha-sorted on macOS+Linux, but
# tools that bypass shell expansion can lose order otherwise.
IFS=$'\n' SORTED=($(printf '%s\n' "${FILES[@]}" | sort))
unset IFS

echo ">> Pushing ${#SORTED[@]} migration(s) to project $PROJECT_REF"
for f in "${SORTED[@]}"; do
  echo "----"
  echo ">> $(basename "$f")"
  SUPABASE_PAT="$SUPABASE_PAT" PROJECT_REF="$PROJECT_REF" \
    "$PUSH" "$f"
done

echo "----"
echo ">> All ${#SORTED[@]} migration(s) applied."

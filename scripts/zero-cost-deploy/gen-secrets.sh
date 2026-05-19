#!/usr/bin/env bash
# Generate the random secrets agora needs for a fresh zero-cost deploy.
# Run once at the start; paste each KEY=VALUE into BOTH Vercel and Render
# env panels for any secret that's shared across services.
#
# Rotation rules:
# - Re-running this script regenerates EVERY value. If you re-roll any
#   secret that's already in production, you MUST update both Vercel and
#   Render env panels in the same window, then redeploy each service.
# - TASK_JWT_SECRET rotation invalidates every signed task JWT currently
#   in flight (in-flight agent CLI calls fail; daemons remint within a
#   heartbeat). Logged-in user sessions are unaffected — those use
#   Supabase JWTs verified against Supabase's JWKS.
# - INTERNAL_RPC_TOKEN and CRON_SECRET are reserved for future
#   Vercel<->Render auth and scheduled-route auth respectively. They
#   aren't read by any current code path, but generating them now keeps
#   the env surface stable across deploys.
# - Any value that appears in your terminal scrollback, chat transcript,
#   or commit diff is leaked. Rotate it before pointing real users at
#   the URL.

set -euo pipefail

# Cross-platform 32-byte hex. Hex avoids `+/=` so it pastes cleanly into
# any UI; Render's env editor in particular has bitten people on `=`.
rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | xxd -p -c 64
  fi
}

cat <<EOF
# === Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) ===
# Copy this WHOLE block. Paste into the Vercel env paste box (KEY=VALUE
# rows split automatically — see DEPLOY.md). Then paste the same pairs
# into the Render service Environment tab.
#
# Any secret that appears in BOTH Vercel and Render MUST be the same
# value. Generate once; don't re-roll per service.

# --- Per-task JWT signing (server/src/middleware/auth.ts +
# server/src/lib/task-jwt.ts read this). Daemon mints short-lived JWTs
# for spawned coding-agent processes so their CLI calls back to /api
# carry agent identity. Render env name MUST be TASK_JWT_SECRET — the
# old JWT_SECRET name is unused by the runtime and would silently fall
# back to a hardcoded dev secret. ---
TASK_JWT_SECRET=$(rand_hex)

# --- Inter-service auth (Vercel <-> Render). Reserved for future use;
# generate now so the env surface is stable across deploys. ---
INTERNAL_RPC_TOKEN=$(rand_hex)

# --- Cron route authorization. Not currently used (agora has zero
# scheduled HTTP routes), but generate to keep the surface stable. ---
CRON_SECRET=$(rand_hex)

# === Reminder: rotate any of these that leak to stdout, chat,
# screenshots, or commits before going live. ===
EOF

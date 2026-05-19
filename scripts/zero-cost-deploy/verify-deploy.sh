#!/usr/bin/env bash
# Smoke test a fresh agora deploy. Returns 0 if every check passes,
# non-zero on any failure.
#
# Usage:
#   WEB_URL=https://your-app.vercel.app \
#   SERVER_URL=https://your-svc.onrender.com \
#     ./verify-deploy.sh

set -euo pipefail

: "${WEB_URL:?WEB_URL not set (e.g. https://agora.vercel.app)}"
: "${SERVER_URL:?SERVER_URL not set (e.g. https://agora-server.onrender.com)}"

WEB_URL="${WEB_URL%/}"
SERVER_URL="${SERVER_URL%/}"

pass() { printf "  \033[32mOK\033[0m  %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m %s\n" "$1"; FAILED=1; }

FAILED=0
echo ">> Smoke test: $WEB_URL  -->  $SERVER_URL"

# 1. Landing page — accept any non-error redirect chain.
CODE=$(curl -sS -o /dev/null -w "%{http_code}" "$WEB_URL/")
if [[ "$CODE" =~ ^(200|307|308)$ ]]; then
  pass "GET $WEB_URL/ -> $CODE"
else
  fail "GET $WEB_URL/ -> $CODE (expected 200/307/308)"
fi

# 2. /login must render (it's the unauthenticated entry point).
CODE=$(curl -sS -o /dev/null -w "%{http_code}" "$WEB_URL/login")
if [[ "$CODE" == "200" ]]; then
  pass "GET $WEB_URL/login -> 200"
else
  fail "GET $WEB_URL/login -> $CODE (expected 200)"
fi

# 3. Server healthz — Render Free cold start can take 30-60 s on the
#    first hit after sleep; --max-time 90 covers it. The route returns
#    {status:"ok",ok:true,db:"up"} on success.
BODY=$(curl -sS --max-time 90 "$SERVER_URL/healthz" || true)
if [[ "$BODY" == *'"ok":true'* ]]; then
  pass "GET $SERVER_URL/healthz -> ok"
else
  fail "GET $SERVER_URL/healthz -> '$BODY' (expected {...\"ok\":true...})"
fi

# 4. /api/me must reject unauthenticated requests with 401.
CODE=$(curl -sS -o /dev/null -w "%{http_code}" "$SERVER_URL/api/me")
if [[ "$CODE" == "401" ]]; then
  pass "GET $SERVER_URL/api/me (no auth) -> 401"
else
  fail "GET $SERVER_URL/api/me (no auth) -> $CODE (expected 401)"
fi

# 5. CORS preflight from the Vercel origin must succeed with the right
#    Access-Control-Allow-Origin echoed back. Hono's cors() returns 204
#    on OPTIONS and only echoes origins from ALLOWED_ORIGINS, so this
#    catches a misconfigured ALLOWED_ORIGINS env on Render.
PREFLIGHT=$(curl -sS -i -X OPTIONS "$SERVER_URL/api/me" \
  -H "Origin: $WEB_URL" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization,content-type")
PRE_CODE=$(printf "%s" "$PREFLIGHT" | awk 'NR==1{print $2}')
PRE_ACAO=$(printf "%s" "$PREFLIGHT" | awk 'tolower($1)=="access-control-allow-origin:"{print $2}' | tr -d '\r')
if [[ "$PRE_CODE" == "204" && "$PRE_ACAO" == "$WEB_URL" ]]; then
  pass "OPTIONS $SERVER_URL/api/me (origin=$WEB_URL) -> 204 ACAO=$PRE_ACAO"
else
  fail "OPTIONS $SERVER_URL/api/me (origin=$WEB_URL) -> code=$PRE_CODE ACAO='$PRE_ACAO' (expected 204 + matching origin; check Render ALLOWED_ORIGINS)"
fi

echo ""
if [[ $FAILED -eq 0 ]]; then
  echo ">> All checks passed."
  exit 0
else
  echo ">> One or more checks failed."
  exit 1
fi

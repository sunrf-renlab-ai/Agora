# Agora — Zero-Cost Production Deploy

Ship agora to production on **$0/month**: Supabase (Postgres + Auth +
Storage), Render Free (bun server, WebSockets), Vercel Hobby (Next.js).
GitHub Actions keeps Render warm and runs CI.

```
Browser ──HTTPS──> Vercel (Next.js) ──rewrites /api/* /ws──> Render (bun) ──> Supabase
```

Repo artifacts: `Dockerfile`, `render.yaml`, `web/vercel.json`,
`scripts/zero-cost-deploy/` (gen-secrets, push-all-migrations,
verify-deploy, verify-tables), `.github/workflows/deploy.yml`,
`.github/workflows/keep-render-warm.yml`.

## Order — strict

```
0. Pre-flight    → gen-secrets.sh
1. Supabase      → project + URL + secret key + DB password
2. Render        → uses Supabase URL + service-role + TASK_JWT_SECRET
3. Vercel        → uses Supabase URL + anon + Render URL
4. GitHub secrets → VERCEL_* + RENDER_DEPLOY_HOOK + RENDER_HEALTHZ_URL
5. Smoke test    → verify-deploy.sh
6. Rotate        → anything that touched stdout / chat / screenshots
```

---

## 0. Pre-flight

```bash
brew install bun supabase/tap/supabase gh jq curl
bash scripts/zero-cost-deploy/gen-secrets.sh > /tmp/agora-secrets.txt
```

Prints `TASK_JWT_SECRET`, `INTERNAL_RPC_TOKEN`, `CRON_SECRET`. Any secret
that ends up in both Vercel and Render must be the **same value** in
both — don't re-roll per service.

---

## 1. Supabase

New project at https://supabase.com/dashboard. Region close to users
(`us-east-2`, `ap-northeast-1`). Free plan. **Save the DB password** —
you can't retrieve it later.

**Project Settings → API → Data API** gives you:

| Field | Use as |
|---|---|
| Project URL | `SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_URL` |
| `sb_publishable_…` | `SUPABASE_ANON_KEY` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `sb_secret_…` | `SUPABASE_SERVICE_ROLE_KEY` (server-only, never to browser) |
| Project Ref | `PROJECT_REF` for CLI / Management API |

**Database → Connection string → URI** → `DATABASE_URL`. Use the
**Pooler** variant (`aws-0-<region>.pooler.supabase.com:6543`) — the
direct `:5432` hostname is IPv6-only and breaks on most networks.

**Authentication → URL Configuration**:
- Site URL: your Vercel origin (placeholder OK now, fix after step 3)
- Redirect URLs: `https://<your-app>.vercel.app/**` + any preview patterns

**Authentication → Providers** (e.g. GitHub): create an OAuth App at
https://github.com/settings/developers with callback
`https://<ref>.supabase.co/auth/v1/callback`, paste client ID/secret.

### Migrations — two paths

**Path A (default): CLI.** Use when raw TCP to `:6543` works:

```bash
supabase login
supabase link --project-ref <project-ref>
cd server && bun drizzle-kit migrate
```

**Path B: Management API.** Use on Clash/Mihomo TUN+fakeip, corporate
firewall, or anything that blocks non-HTTPS ports. Symptom on Path A:
`tls error (EOF)`, `dial timeout`, or `Network is unreachable`.

1. Generate a PAT at https://supabase.com/dashboard/account/tokens → copy `sbp_…`
2. Push migrations + verify:

```bash
SUPABASE_PAT="sbp_…" PROJECT_REF="<ref>" \
  bash scripts/zero-cost-deploy/push-all-migrations.sh

SUPABASE_PAT="sbp_…" PROJECT_REF="<ref>" \
  bash scripts/zero-cost-deploy/supabase-verify-tables.sh
```

The wrapper iterates `supabase/migrations/*.sql` in filename order and
POSTs each through `api.supabase.com`. Single-file variant:
`scripts/zero-cost-deploy/supabase-push-migration.sh`.

---

## 2. Render — server

1. https://dashboard.render.com → **New +** → **Blueprint** → connect
   repo. Render detects `render.yaml` and proposes `agora-server`.
2. Fill each `sync: false` prompt from `/tmp/agora-secrets.txt` + Supabase:
   - `DATABASE_URL` (Pooler URI)
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (`sb_publishable_…`),
     `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_…`)
   - `TASK_JWT_SECRET` (from gen-secrets — server reads this name; do NOT call it `JWT_SECRET`, that env name is unused by the runtime and would silently fall back to a hardcoded dev secret)
   - `FRONTEND_ORIGIN` — Vercel web origin, used to construct invite URLs
   - `ALLOWED_ORIGINS`, `APP_URL` — placeholders (e.g. `http://localhost:3001`); fix after Vercel
3. Click **Apply**. ~5 min first build.

### GOTCHA: VERIFY ENV VARS SAVED

Render Blueprint apply has a known bug where `sync: false` values
silently fail to save. Service builds with EMPTY env and crashes at
boot (`missing DATABASE_URL`, `TASK_JWT_SECRET undefined`). **Always
verify immediately after Apply:**

1. Service → Environment → click **Edit** on each variable
2. Confirm a non-empty Value (paste it if empty)
3. **Save, rebuild, and deploy**

This is the #1 Render gotcha — most common cause of first-deploy crash loops.

4. Note the public URL (`https://agora-server.onrender.com`).
   `/healthz` should return `{"status":"ok","ok":true,"db":"up"}`.
5. **Settings → Deploy Hook** → copy → `RENDER_DEPLOY_HOOK` GitHub secret.

---

## 3. Vercel — web

1. Edit `web/vercel.json` — replace `agora-server.onrender.com` in
   both `rewrites` with your real Render hostname. Commit + push.
2. https://vercel.com/new → **Continue with GitHub** → import repo. If
   "No repositories found": **Configure account** → install Vercel's
   GitHub App on the org.
3. Project config page:
   - **Root Directory** → `web` (critical — otherwise Vercel runs
     `next build` from repo root and misses `next.config.ts`)
   - Framework: Next.js (auto)
   - **Don't click Deploy yet** — expand Environment Variables first.

### Paste env vars — the ClipboardEvent trick

Vercel's env form uses React-controlled inputs that ignore programmatic
`input`/`change` events. But it DOES listen for clipboard `paste` and
auto-splits `KEY=VALUE\nKEY=VALUE` into rows.

Block to paste:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_…
```

Click the empty **Key** input (placeholder `EXAMPLE_NAME`), then
**Cmd+V**. All rows expand. Scripted variant for DevTools:

```js
const block = `NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_…`;
const keyInput = document.querySelector('input[placeholder="EXAMPLE_NAME"]');
const dt = new DataTransfer();
dt.setData('text/plain', block);
keyInput.focus();
keyInput.dispatchEvent(new ClipboardEvent('paste', {
  clipboardData: dt, bubbles: true, cancelable: true,
}));
```

Remove any blank trailing rows — Deploy stays disabled otherwise.

4. **Deploy**. ~3 min build.
5. Note the production URL. Vercel may auto-append a random suffix
   (`-amiz`) if the name is taken — accept or rename in Settings → General.
6. Back in Render → Environment, set:
   - `APP_URL = https://<your-app>.vercel.app`
   - `ALLOWED_ORIGINS = https://<your-app>.vercel.app`

   **Save, rebuild, and deploy**. Without this, browser requests fail CORS.

> **Vercel crons.** Agora has **zero** scheduled routes, so the
> Hobby daily-only cap doesn't bite. If you ever add one, Hobby allows
> only `MM HH * * *` (up to 3 daily) — sub-daily must go through
> GitHub Actions (see `keep-render-warm.yml` for the pattern).

---

## 4. GitHub secrets

Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Source |
|---|---|
| `VERCEL_TOKEN` | https://vercel.com/account/tokens |
| `VERCEL_ORG_ID` | Vercel → Settings → General → Team/User ID |
| `VERCEL_PROJECT_ID` | Vercel project → Settings → General |
| `RENDER_DEPLOY_HOOK` | Render service → Settings → Deploy Hook |
| `RENDER_HEALTHZ_URL` | `<render-url>/healthz` for warm-up cron |

`deploy.yml` runs typecheck + tests + deploys on push to `master`/`main`.
`keep-render-warm.yml` pings `/healthz` every 13 min so user requests
don't pay the 30–60 s cold-start tax.

---

## 5. Smoke test

```bash
WEB_URL=https://<your-app>.vercel.app \
SERVER_URL=https://<your-svc>.onrender.com \
  bash scripts/zero-cost-deploy/verify-deploy.sh
```

Asserts: `/` 200/307, `/login` 200, `/healthz` `ok:true`, `/api/me` 401
without auth, CORS preflight 204 with matching ACAO (catches a
mistyped `ALLOWED_ORIGINS` on Render).

End-to-end smoke (manual): open the Vercel URL → sign in with GitHub →
create workspace + issue + comment → install the daemon:

```bash
cd local && bun run build:bin
./dist/agorad-darwin-arm64 login --server https://<your-app>.vercel.app
./dist/agorad-darwin-arm64 daemon start
```

The runtime should appear live in the web UI within ~5 s.

---

## 6. Rotate exposed secrets

Anything that appeared in stdout, chat, screenshots, or commits is
**leaked**. Rotate before pointing real users at the URL.

| Type | Where |
|---|---|
| Supabase `sb_secret_…` | Settings → API → revoke → create new → update Vercel + Render |
| Supabase PAT (`sbp_…`) | https://supabase.com/dashboard/account/tokens → delete |
| `TASK_JWT_SECRET` | Render env → rotate → redeploy (invalidates all in-flight task JWTs; daemons reconnect within a heartbeat) |
| `INTERNAL_RPC_TOKEN`, `CRON_SECRET` | Regenerate (no live consumers — safe) |
| `DATABASE_URL` password | Supabase → Settings → Database → Reset → update Render |

---

## Optional fourth service: Upstash Redis

Agora doesn't need rate limiting, distributed locks, or ephemeral
cross-service state today — in-memory `daemonHub` covers runtime
presence within a single dyno. **Skip Upstash unless** you add
horizontal scaling, per-IP `/api/*` rate limiting, or distributed
autopilot leader election. If you do, see `sunrf-renlab-ai/serverless`
for the Management API path (the region combobox ignores synthetic
events — UI is unscriptable).

---

## Gotchas

### Clash/Mihomo TUN mode breaks raw TCP
`supabase db push` / `bun drizzle-kit migrate` fails with `tls error
(EOF)` or `dial timeout`; DNS returns `198.18.x.x`. Fakeip allocates
`198.18.0.0/15` for non-domestic hosts; TUN drops raw TCP to `:5432` /
`:6543`. **Fix:** `scripts/zero-cost-deploy/push-all-migrations.sh`
(Management API over HTTPS). Or switch proxy to "rule" mode for
`*.supabase.co`. Or disable proxy for the deploy.

### Render Blueprint env loss
Blueprint Apply completes; build succeeds; service crashes on boot
with `missing DATABASE_URL`. `sync: false` values silently failed to
persist. **Fix:** Service → Environment → Edit each empty var → paste
→ Save, rebuild, and deploy. The warning at the top of `render.yaml`
exists for this. **Always verify post-Apply.**

### Vercel env paste trick
`input.value = ...; dispatchEvent(new Event('input'))` leaves values
blank — React's value tracker ignores synthetic events. **Fix:**
`ClipboardEvent('paste')` with `clipboardData` set to a KEY=VALUE
block. Snippet in step 3.

### Render Free cold start
First request after idle waits 30–60 s. **Fix:**
`.github/workflows/keep-render-warm.yml` pings `/healthz` every 13 min
(needs `RENDER_HEALTHZ_URL` secret).

### GitHub OAuth Authorize button disabled
During Render/Vercel OAuth signup, GitHub's Authorize button stays
grayed out 2–4 s. JS clicks during this window are silently ignored.
**Fix:** manual click — JS can't synthesize a trusted gesture without
OS-level Accessibility.

### Supabase project pause after 7 days
All Supabase requests 503 or hang. Dashboard shows "project paused".
**Fix:** click **Resume project**. Production traffic keeps it warm;
pre-launch, add a daily GH Actions cron hitting
`https://<ref>.supabase.co/auth/v1/health`.

### Vercel auto-suffix
Expected `agora.vercel.app`, got `agora-amiz.vercel.app` — name taken
globally. **Fix:** accept, rename in Settings → General, or attach a
custom domain.

### Preview URL 401 vs production URL 200
Vercel Authentication is enabled on preview deployments
(Settings → Security). **Fix:** smoke-test against the production
alias, or disable preview protection.

---

## What this does NOT cover

- **Custom domains.** Vercel + Render both free at Settings → Domains.
- **Email delivery for invitations.** Wire SUPABASE SMTP or third-party
  provider before relying on invite emails.
- **Backups.** Supabase Free includes 7-day PITR (Settings → Database → Backups).
- **Sentry.** `NEXT_PUBLIC_SENTRY_DSN` is already wired in
  `web/next.config.ts`; add the env var when ready.
- **Windows daemon builds.** Dockerfile cross-compiles
  `agorad-{darwin-arm64,darwin-x64,linux-x64}` only.

<!-- 2026-05-12T09:05:01Z deployed @ https://agora-zeta-three.vercel.app -->
<!-- autodeploy test 2026-05-12T09:11:38Z -->

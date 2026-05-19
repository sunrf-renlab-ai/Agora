# OAuth Connections — Going Live Per Provider

The Agora OAuth framework is fully built and tested (server routes,
state CSRF, AES-256-GCM token-at-rest encryption, web Connect flow,
callback handler). It will not light up until **you register an OAuth
app at each provider's developer console** and copy the resulting
`client_id` + `client_secret` into Render env vars. This doc walks you
through that for all four supported providers.

## Shared env vars (set once)

| Env var | Value | Where |
|---|---|---|
| `AGORA_TOKEN_ENCRYPTION_KEY` | 32+ random bytes (any printable string ≥16 chars works) | Render → agora-server → Environment |
| `AGORA_OAUTH_CALLBACK_URL` | `https://agora-server-ub50.onrender.com` (no trailing slash) | Render. Optional — defaults to the request origin, only override if you front the API behind a different domain that the providers must redirect to. |
| `APP_URL` | `https://agora-zeta-three.vercel.app` (Vercel web origin) | Already set; the OAuth callback redirects users back here after the exchange. |

Generate the encryption key with:

```bash
openssl rand -hex 32
# or
head -c 32 /dev/urandom | xxd -p -c 64
```

Once set, **redeploy** so the server picks it up.

## The redirect URI you'll register

For every provider's app config, the redirect URI is:

```
https://agora-server-ub50.onrender.com/api/connections/callback
```

This is intentionally on the **Render** origin (not the Vercel web
origin) — the callback handler runs on the server, not the web app.

## Provider-by-provider

### 1. Linear

1. Go to <https://linear.app/settings/api/applications/new>
2. Application name: `Agora`. Description: `AI agent collaboration`.
3. Redirect URLs: add `https://agora-server-ub50.onrender.com/api/connections/callback`
4. Scopes: `read` (the framework requests it).
5. After saving, copy the Client ID + Client Secret.
6. Render → Environment → add:
   - `AGORA_LINEAR_CLIENT_ID`
   - `AGORA_LINEAR_CLIENT_SECRET`
7. Redeploy.

### 2. GitHub

1. <https://github.com/settings/developers> → **New OAuth App**.
2. Application name: `Agora`.
3. Homepage URL: `https://agora-zeta-three.vercel.app`.
4. Authorization callback URL: `https://agora-server-ub50.onrender.com/api/connections/callback`
5. Click Register, then **Generate a new client secret**.
6. Copy Client ID + Secret to Render:
   - `AGORA_GITHUB_CLIENT_ID`
   - `AGORA_GITHUB_CLIENT_SECRET`
7. Redeploy.

(Default scopes requested: `repo` and `read:user`. Adjust in
`server/src/services/oauth-providers.ts` if you want narrower access.)

### 3. Notion

1. <https://www.notion.so/my-integrations> → **New integration**.
2. Choose **Public integration** (so the OAuth flow is available;
   private integrations don't have OAuth).
3. Name: `Agora`. Logo + description optional.
4. Redirect URIs: `https://agora-server-ub50.onrender.com/api/connections/callback`
5. Copy OAuth client ID + secret.
6. Render env:
   - `AGORA_NOTION_CLIENT_ID`
   - `AGORA_NOTION_CLIENT_SECRET`
7. Redeploy.

Notion's OAuth is per-workspace: each user picks which Notion
workspace to grant Agora access to. The token Agora stores is bound
to that one workspace.

### 4. Slack

1. <https://api.slack.com/apps> → **Create New App** → **From
   scratch**. Name: `Agora`. Pick your dev workspace.
2. Sidebar → **OAuth & Permissions**.
3. Redirect URLs: add
   `https://agora-server-ub50.onrender.com/api/connections/callback`
4. Under **User Token Scopes** add: `users:read`, `channels:read`.
   (We use the user-scoped flow so the token represents the
   individual member, not a bot.)
5. Sidebar → **Basic Information**. Copy Client ID + Client Secret.
6. Render env:
   - `AGORA_SLACK_CLIENT_ID`
   - `AGORA_SLACK_CLIENT_SECRET`
7. Slack apps need **distribution** turned on for OAuth to work
   from accounts other than the workspace where the app was made.
   Sidebar → **Manage Distribution** → **Activate Public
   Distribution** when ready.
8. Redeploy.

## What happens behind the scenes

```
[Web]  user clicks Connect on a provider card
         → POST /api/connections/<kind>/start (server)
         → server returns { authorizeUrl }
         → browser navigates to provider's authorize URL
         → user grants consent
         → provider redirects to /api/connections/callback?code=...&state=...
         → server validates state (CSRF), POSTs to provider's token endpoint
         → AES-256-GCM encrypts access_token + refresh_token
         → upserts into user_connection (per user, per kind)
         → 302s back to /__connection-callback?status=connected
         → web parks a flash, redirects to /workspaces
         → /knowledge page on next load shows Connected + toast
```

## Disconnecting

The Connected card on `/knowledge` shows a **Disconnect** button. It
deletes the `user_connection` row. The token at the provider end is
NOT revoked automatically — that's a per-provider operation. If you
want full revocation, do it manually at the provider's connected-apps
page first, then click Disconnect.

## When it doesn't light up

| Symptom | Cause |
|---|---|
| `AGORA_TOKEN_ENCRYPTION_KEY must be set` 500 on Connect | Set the env var on Render and redeploy |
| `OAuth not configured for <kind>` 503 returned, web shows the stub modal | `AGORA_<KIND>_CLIENT_ID` or `_SECRET` missing on Render |
| Callback redirects with `status=failed&reason=invalid_state` | Most often: user took >10 min to authorize (state expired) — they should retry |
| Callback fails with `status=failed&reason=exchange_failed` | Provider rejected the code. Check the redirect URI registered at the provider matches **exactly** the one in the env (incl. https / no trailing slash) |
| Callback fails with `reason=no_access_token` | Slack: scope issue, the user_scope was not granted — re-check Slack app's User Token Scopes |

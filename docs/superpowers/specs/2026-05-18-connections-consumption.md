# Connections consumption layer — GitHub + Slack — 2026-05-18

## Problem

Agora's connections feature stores OAuth tokens for Linear / GitHub /
Notion / Slack (encrypted, in `user_connection.config`), but nothing
ever reads them back — `decryptToken` has zero production callers.
Connecting a service has no effect. This spec makes **GitHub** and
**Slack** connections actually do something. Linear and Notion are out
of scope.

The two services have genuinely different natural consumption modes, so
each gets its own:

- **GitHub** — inject the connecting user's token into their agents'
  CLI environment, so a coding agent can `git push` / open PRs / read
  private repos as that user.
- **Slack** — outbound notifications: when an issue is escalated or an
  agent task fails terminally, also DM the affected humans in Slack.

## Part 1 — GitHub: inject the owner's token into the agent CLI

When the daemon claims a task, the server includes the agent owner's
decrypted GitHub token in the claim response. The daemon sets it as
`GH_TOKEN` + `GITHUB_TOKEN` in the spawned agent CLI's environment.

### Server (`server/src/routes/daemon.ts`, claim handler)

- The claim handler already loads the `agent` row (with `ownerId`) in
  its "wave 1" `Promise.all`. Add a wave-2 query: if `agent.ownerId` is
  set, look up `user_connection` for `(userId = ownerId, kind = 'github',
  status = 'connected')`.
- Decrypt `config.access_token` via `decryptToken`. Wrap in try/catch —
  a decrypt failure (rotated key, tampered row) yields `null`, never
  breaks the claim.
- Add `githubToken: string | null` to the top-level claim response.

### Daemon (`local/src/`)

- Add `githubToken?: string | null` to the `ClaimResponse` interface
  (`local/src/prompts.ts`).
- When the runner spawns the agent CLI child process, if `githubToken`
  is present, add `GH_TOKEN` and `GITHUB_TOKEN` to the child env (both —
  `gh` reads `GH_TOKEN`, `git` credential helpers and most libraries
  read `GITHUB_TOKEN`).

### Security

The token is the agent owner's own GitHub token, delivered over HTTPS
to the daemon that runs that owner's agent — the user's credential on
the user's machine, acting as them. Acceptable. The token must never be
logged or written into task messages / CLAUDE.md.

## Part 2 — Slack: outbound notifications

### OAuth: switch Slack from user-scope to a bot token

To DM a user, Agora needs a **bot token** with `chat:write`, plus the
Slack user id to DM. The current Slack config is inconsistent (requests
bot-shaped scopes but parses a user token). Fix it cleanly — the
feature is unused, so there are no live connections to migrate:

- `oauthByKind.slack.scopes` → `"chat:write"` (bot scope; `buildAuthorizeUrl`
  already puts `cfg.scopes` in the `scope` param — no change needed there).
- `parseTokenResponse` for slack: `accessToken = raw.access_token` (the
  top-level bot token), `accountId = raw.authed_user.id` (the Slack user
  to DM), `accountLabel` from `raw.team.name`.
- Add `accountId?: string` to `ParsedToken`.
- The callback (`connections.ts`) stores `account_id: parsed.accountId ?? null`
  in `config` alongside the existing fields.

### Slack client (`server/src/lib/slack.ts`, new)

`postSlackMessage(botToken, channel, text): Promise<boolean>` — POSTs to
`chat.postMessage` (channel = the Slack user id opens a DM). Returns
whether Slack reported `ok: true`. Never throws.

### Wire into the notify path (`server/src/lib/escalation.ts`)

`notifyIssueHumans` already computes the human recipient set and inserts
inbox items for escalations + terminal task failures. Extend it: after
the inbox insert, look up `user_connection` rows for those recipients
with `kind = 'slack', status = 'connected'`, decrypt each bot token,
read `config.account_id`, and `postSlackMessage` a one-line summary
(title + body). Best-effort: each post is wrapped so a Slack failure
never breaks the inbox path; the whole fan-out is `Promise.allSettled`.

This means an escalation or a failed agent task reaches a connected
human both in the Agora inbox and as a Slack DM.

## Out of scope

- Linear, Notion consumption.
- GitHub issue ↔ Agora issue sync (token injection only).
- Slack inbound (slash commands, bot chat) — outbound DM only.
- Token refresh — GitHub OAuth-app tokens and Slack bot tokens don't
  expire by default; skip refresh.
- Notifying on task *completion* — only escalation + terminal failure,
  matching the existing `notifyIssueHumans` triggers.

## No DB schema change

`user_connection.config` is JSONB — `account_id` slots in freely. The
claim response is a wire type, not a table.

## Files

| File | Change |
|---|---|
| `server/src/services/oauth-providers.ts` | slack scope → `chat:write`; slack parse captures `accountId`; `ParsedToken.accountId` |
| `server/src/routes/connections.ts` | callback stores `config.account_id` |
| `server/src/lib/slack.ts` | new — `postSlackMessage` |
| `server/src/lib/escalation.ts` | `notifyIssueHumans` also DMs connected recipients on Slack |
| `server/src/routes/daemon.ts` | claim response includes owner's decrypted `githubToken` |
| `shared/` / `local/src/prompts.ts` | `ClaimResponse.githubToken` |
| `local/src/` runner | inject `GH_TOKEN` / `GITHUB_TOKEN` into the agent CLI env |

## Verification

- `bun run --filter '*' typecheck`, `bun --filter web build` clean.
- `bun --filter server test` + `bun --filter '@agora/daemon' test` pass.
- New tests: claim response carries `githubToken` when the owner has a
  connected GitHub connection (and `null` when not); `postSlackMessage`
  posts the right shape and reports `ok` (fetch mocked); escalation with
  a Slack-connected recipient triggers a Slack post (fetch mocked).
- Manual: agent with a GitHub-connected owner can run `gh`/`git` against
  private repos; escalating an issue DMs a Slack-connected owner.

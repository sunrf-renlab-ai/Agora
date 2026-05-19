# Settings

Workspace and personal settings live under `/<slug>/settings`. Use `g s` to jump there. The page has tabs for each section below.

## Profile

Personal, applies across every workspace you're a member of.

| Field | What it does |
|---|---|
| **Name** | Display name on issues, comments, mentions. |
| **Avatar URL** | Image URL (we don't host uploads — paste a public URL or use a Gravatar). |

Save → updates propagate to all workspaces immediately.

## Notifications

Per-workspace. You decide which events trigger an email or in-app banner.

Notification groups (each toggleable):

- **Issue assigned** — someone (or an agent) assigned an issue to you.
- **Issue mentioned** — `@you` in an issue body or comment.
- **Issue subscribed** — anything happens on an issue you're watching.
- **Agent run completed** — a task finished (success or failure).
- **Workspace invitations** — invite accepted or declined.
- **Autopilot fired** — a recurring autopilot ran (off by default; turn on for debugging).

Each group has independent **email** and **in-app** toggles.

## Tokens (Personal Access Tokens)

For driving Agora from the CLI, scripts, or third-party integrations.

Create:

1. Settings → **Tokens** → **New token**.
2. Name it (`laptop-cli`, `ci-pipeline`).
3. Pick scopes: `read`, `write`, or both.
4. Click **Create**.

> **Copy the cleartext token immediately** — it's shown only once. After you leave this dialog, only the prefix (e.g. `ag_pat_8f3a...`) remains visible. If you lose it, revoke and create a new one.

Use the token by setting `AGORA_TOKEN`:

```bash
export AGORA_TOKEN=ag_pat_8f3a...
export AGORA_SERVER_URL=https://your-agora-host
export AGORA_WORKSPACE_ID=<workspace-uuid>
agora issue list
```

Revoke at any time → the token stops working immediately.

## Feedback

Send the maintainers a note: bug report, feature request, or kudos. Submissions land in a private inbox; we read everything.

If you're self-hosting, this routes to whichever address the operator configured in `FEEDBACK_RECIPIENT_EMAIL`. Default is to no-op (silently dropped) if unset.

## Workspace

Visible only to admins. Combines:

- **Members** — list of members with roles. Click a row → **Change role** or **Remove**.
- **Invitations** — pending invites with their expiry. Click → **Resend** or **Revoke**.
- **Workspace details** — name, slug. Slug changes break old URLs and require admin confirmation.
- **Danger zone** — delete workspace. Requires typing the slug to confirm. Irreversible.

## Other settings tabs

The same Settings nav also contains: **Runtimes** (see [Agents](./agents.md)), **Agents** (see [Agents](./agents.md)), **Autopilots** (see [Autopilot](./autopilot.md)), **Skills** (see [Skills](./skills.md)), **Labels**, and **Projects**.

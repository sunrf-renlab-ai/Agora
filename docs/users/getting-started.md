# Getting started

This walks the first five minutes on Agora: sign in, create a workspace, invite teammates, file an issue.

## 1. Sign in

Open `https://your-agora-host/login` (or `http://localhost:3001/login` if you're self-hosting). The login page offers GitHub OAuth. Click **Sign in with GitHub** and approve the OAuth scopes. You'll land at `/inbox`, which is empty until your first workspace exists.

> If you self-host without GitHub OAuth configured, see [`../self-host.md`](../self-host.md#authentication) for alternatives.

## 2. Create a workspace

A workspace is the unit of isolation in Agora — every issue, agent, runtime, and skill is scoped to one workspace. Click **Create workspace** in the top-left switcher. Pick:

- **Name** — what teammates see (e.g. "Acme Engineering").
- **Slug** — the URL fragment. Must be unique across the host. Lowercase, kebab-case (`acme-eng`).

Submit. You'll land on `/{slug}/issues`, which is the workspace board.

## 3. Invite teammates

Go to **Settings → Members** (or press `g` then `s`, then click **Members**).

- Click **Invite** and enter one or more email addresses, comma-separated.
- Pick a role: **Admin** (manage settings + members) or **Member** (everything else).
- Send. Each invitee gets an email with a one-time link that lasts 7 days. They sign in via the same GitHub OAuth, then auto-join your workspace.

You can copy the raw invite URL from the **Pending invites** table if their inbox is being slow.

## 4. File your first issue

Press `c` from anywhere in the workspace, or click **New issue** on the board.

The issue dialog asks for:

- **Title** — required.
- **Description** — Markdown + Tiptap rich text. Supports code blocks, mentions (`@alice`), and skill links (`#deploy`).
- **Status** — defaults to `triage`. Options: `triage`, `backlog`, `todo`, `in_progress`, `in_review`, `done`, `cancelled`.
- **Priority** — `none`, `low`, `medium`, `high`, `urgent`.
- **Assignee** — pick a member or an agent. Assigning to an agent enqueues the issue immediately.
- **Labels** — multi-select. Workspace-level.
- **Project** — optional grouping.

Submit. The issue appears on the board and gets a stable identifier like `ENG-1`. If you assigned an agent, you'll see `dispatched → running → done` move through the activity feed within seconds (assuming a runtime is online — see [Agents](./agents.md)).

## Keyboard shortcuts

The most common ones to learn early:

| Key | What it does |
|---|---|
| `c` | Open the New Issue dialog |
| `g i` | Go to issues |
| `g a` | Go to agents |
| `g s` | Go to settings |
| `Cmd/Ctrl + K` | Command palette (find issues, agents, skills, jump anywhere) |
| `?` | Show all shortcuts |

## Next steps

- [Agents](./agents.md) — connect your first runtime and create an agent.
- [Issues](./issues.md) — the full issue model: status flow, search, dependencies.
- [CLI](./cli.md) — drive Agora from the terminal.

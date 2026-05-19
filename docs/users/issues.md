# Issues

The issue is Agora's core unit of work. Anyone — human or agent — can file one, comment on it, change its status, or hand it off.

## Create

Three ways to create an issue:

1. **Press `c`** anywhere in the workspace → New Issue dialog.
2. **Click `+ New issue`** on the board or in any list view.
3. **CLI**: `agora issue create --title "Fix login redirect" --priority high`. See [CLI](./cli.md).

The minimum required field is **title**. Everything else has sensible defaults.

## Identifier

Each issue gets a stable identifier like `ENG-42`, where the prefix is derived from the workspace slug (or a per-team prefix if you've created teams). The identifier is permanent — even if you change the issue's title, the URL `https://your-host/eng/ENG-42` keeps working.

## Status

Agora uses a fixed set of statuses, broken into logical groups:

| Status | Group | When to use |
|---|---|---|
| `triage` | open | Default for new issues you haven't decided on. |
| `backlog` | open | Decided to do later. |
| `todo` | open | Ready to start. Agents pick from `todo` if assigned. |
| `in_progress` | open | Actively being worked. |
| `in_review` | open | Code review or QA. |
| `done` | closed | Shipped. |
| `cancelled` | closed | Won't do. |

Change status from the issue page (status pill, top-right) or from the board (drag the card between columns). Agents update status automatically when they start (`in_progress`) and complete (`done` or `cancelled`).

## Assign

The assignee is **polymorphic**: it can be either a workspace member or an agent.

- Click the assignee field on an issue → search by name → pick.
- Agents render with a robot icon and a distinct background so they're visually different from humans.
- Assigning to an agent enqueues the issue **immediately** as a task on that agent's runtime. If the runtime is offline, the task sits `queued` and dispatches when the runtime reconnects.

> An issue can have only one assignee at a time. To get parallel work, file separate issues with a parent dependency (see below).

## Search

Press `Cmd/Ctrl+K` for the command palette. Search is full-text over title + description + comments and supports filters:

```
status:in_progress assignee:@alice
status:open priority:high label:deploy
created:>2026-01-01
```

The CLI mirrors this: `agora issue search "auth bug"`.

## Label

Labels are workspace-scoped. Create them in **Settings → Labels** (color + name). Apply on an issue from the labels picker. Labels are filterable from the board and search.

## Dependency

Issues can depend on other issues — useful for milestones and unblock chains.

- Open an issue → **Dependencies** panel → **Add → Blocks / Blocked by / Related to**.
- An issue with unmet `blocked_by` dependencies shows a "Blocked" badge and is excluded from agent dispatch by default. Resolve the blocker to unblock.
- Dependency graphs are visible on the project page when you group by `Dependencies`.

## Comments

Markdown + Tiptap. Mentions notify the mentioned user (`@alice`) or invoke the agent (`@agent-name` posts a comment-trigger task to that agent if Autopilot is configured — see [Autopilot](./autopilot.md)). Comments stream live; you'll see other people typing.

## Subscribers

Anyone subscribed to an issue gets notifications for state changes and comments. Assignees + commenters auto-subscribe. Add yourself manually with the subscribe button or `agora issue subscriber add <id>`.

## Activity feed

Every state change, comment, and agent run leaves a row in the activity feed at the bottom of the issue. This is your audit trail — useful for debugging "why did this issue close?" three months later.

## Bulk operations

From the board or list view: shift-click to multi-select, then use the bulk action bar to change status, assignee, or label across the selection.

# Agent escalation to human — 2026-05-15

## Problem

When an agent genuinely can't complete a task there is no way for it to
hand the work to a human, and plain issue-task failures notify nobody:

- Task state machine has only `completed / failed / cancelled` — no
  structured "I can't do this, a human must" outlet.
- `/api/daemon/tasks/:id/fail` terminal path notifies a human only for
  `quick_create` (inbox) and `chat` (chat message) origin tasks. A plain
  **issue task** failing emits only an ephemeral `task.failed` WS
  broadcast — no inbox item, silent if no browser is open.
- Agents can't reach humans: `extractMentionedUserIds` is stubbed
  (always `[]`), and orchestrator-filed sub-issues have no human
  subscribers, so an agent's "I'm stuck" comment reaches no one.

This blocks the product principle "dispatch to agents first, hand to a
human only when no agent can do it" — the "hand to a human" branch has
no implementation.

## Design

Minimal closed loop, three parts. **No DB migration** — `inboxItems.type`
is free text, `issue.status` already has `blocked`, comment `type`
already has `system`.

### 1. Structured escalation outlet — `agora issue escalate`

New CLI command + endpoint. An agent (or human) running against an issue
declares it can't be done by any agent and needs a human.

- **CLI** (`cli/src/cmd-issue.ts`): `agora issue escalate <id> --reason "<why>"`.
- **Endpoint**: `POST /api/workspaces/:wsId/issues/:issueId/escalate`,
  body `{ reason }` validated by `escalateIssueSchema`.
- Behavior:
  1. Post a `type: "system"` comment on the issue: `**Escalated to a
     human** — <reason>`. Author is the agent when called via task JWT
     (`taskAuth`), else the member.
  2. Set issue `status = "blocked"` (skip if already `done`/`cancelled`).
  3. Notify humans (see §3): inbox `type: "issue_escalated"`,
     `severity: "action_required"`.
  4. Activity log entry; broadcast `issue.updated` + `comment.created`.

### 2. Issue-task terminal failure → inbox

In `server/src/routes/daemon.ts` fail handler, after retries are
exhausted (terminal path), if the task is bound to an issue
(`t.issueId`), notify humans: inbox `type: "issue_task_failed"`,
`severity: "attention"`. Closes the silent-failure gap. Existing
chat/quick-create/autopilot side-effects are unchanged.

### 3. Reliable human recipients — `notifyIssueHumans`

New helper `server/src/lib/escalation.ts`:

```
notifyIssueHumans({ workspaceId, issueId, type, severity, title, body })
```

Recipient set = **workspace owners + admins** (role-based, guaranteed
real humans, always non-empty) ∪ **issue member-subscribers**. Deduped
by user id. Inserts `inboxItems` rows + broadcasts `inbox.created` per
recipient.

Owners+admins is the guaranteed-delivery backbone — orchestrator
sub-issues have no human subscribers, but every workspace has an owner.
This is the "human reachability" fix; un-stubbing `@mention` (needs a
username/handle column) stays out of scope.

### 4. Tell the agent escalation exists

- `local/src/runtime-config.ts`: add `agora issue escalate` to the
  "Available Commands → Write" list with a one-line "when to use it".
- `local/src/prompts.ts` (`buildIssuePrompt` + `buildCommentPrompt`):
  add a line — if the agent genuinely cannot complete the work (needs
  human credentials, a human decision/judgment, or an offline/manual
  action), it must run `agora issue escalate <id> --reason "..."`
  instead of guessing or faking completion.

### Web

`inboxItems.type` is free text; the web inbox renders types generically.
Add icon/label cases for `issue_escalated` and `issue_task_failed` if
the inbox component switches on `type` — otherwise no web change.

## Out of scope

- New task status (`blocked`/`escalated`) — escalation sets the *issue*
  to `blocked`; the task row keeps the existing enum.
- Un-stubbing human `@mention` — needs a handle column; separate work.
- Auto-reassigning the escalated issue to a specific human — we flag +
  notify; a human decides who picks it up.

## Files

| File | Change |
|---|---|
| `shared/src/schemas.ts` | `escalateIssueSchema` |
| `server/src/lib/escalation.ts` | new — `notifyIssueHumans` |
| `server/src/routes/issues.ts` | `POST .../escalate` |
| `server/src/routes/daemon.ts` | issue-task failure → `notifyIssueHumans` |
| `cli/src/cmd-issue.ts` | `escalate` command |
| `local/src/runtime-config.ts` | document `agora issue escalate` |
| `local/src/prompts.ts` | escalation guidance in worker prompts |
| `web/.../inbox` | type icon/label cases (if needed) |

## Verification

- `bun run --filter '*' typecheck`, `bun --filter web build` clean.
- `bun --filter server test` clean (add a test for the escalate
  endpoint + the issue-task-failure inbox path).
- Manual: agent runs `agora issue escalate` → issue goes `blocked`, a
  system comment appears, workspace owner gets an `action_required`
  inbox item. A plain issue task that fails terminally → owner gets an
  `attention` inbox item.

# Linear-style dependency coordination (Model A)

**Status:** in progress (auto-execute, no review gate)
**Date:** 2026-05-14

## Why

Chat orchestrator now files parent + sub-issues, but no way to express
"B must wait for A". `issue_dependency` table + `agora dependencies add`
CLI exist, but the orchestrator never uses them, the issue-workflow
agent never reads `blockedBy`, and `done` events don't unblock anyone.

## Model: Linear-style (A from the discussion)

Three pieces:

1. **Chat orchestrator** plans with explicit serial/parallel structure,
   then on user confirmation files the issues AND adds `blocks` edges.
2. **Issue-workflow agent** (the agent that picks up an assigned issue)
   first checks `blockedBy`. If anything is unfinished, it sets the
   issue to `blocked`, posts a 1-line comment ("waiting on I-12"), and
   exits. Otherwise it works the issue normally.
3. **Server unblock sweep** runs whenever an issue resolves
   (`done` / `cancelled`). For every dependent that is `blocked` and
   assigned to an agent, flip back to `todo` and enqueue a fresh task.

This mirrors Linear's notification-driven coordination, with two
agent-specific adaptations:
- Agents don't have an inbox to "see notifications," so the unblock
  sweep enqueues a real task instead.
- Humans assigned to a blocked issue: the existing inbox + WS
  invalidation already surface the change. No special handling.

## Non-goals

- **Scheduler-level enforcement.** The daemon's claim SQL stays
  unchanged. Blocked issues simply have `status=blocked` and don't
  carry an active task; if a human/agent manually re-assigns or
  re-statuses a blocked issue, the system trusts that.
- **Cycle detection.** Linear doesn't enforce it either. We accept
  the risk that two issues marked as mutually blocking would both
  stay blocked until a human untangles.
- **Estimate / velocity / cycles.** Out of scope for this pass.

## Concrete behaviour

### Chat orchestrator plan format (in chat reply)

```
方案
  父 issue: 给登录加 SSO                         [我自己]

  并行 (一开始就能跑):
    A. 注册 OAuth 应用                          [Backend Bob]
    B. 设计 SSO 登录按钮 mock                  [Frontend Charlie]

  串行:
    C. 后端集成 supabase-js                    [Backend Bob]      (depends on A)
    D. 前端登录按钮接线                        [Frontend Charlie] (depends on B, C)
    E. 写 e2e 测试                              [QA Dora]          (depends on D)

ok 吗?
```

After confirmation, the agent runs:

```bash
parent=$(agora issue create --title "..." --description-stdin <<DESC | jq -r .id)
A=$(agora issue create --parent $parent --assignee-id ... --title "...")
B=$(agora issue create --parent $parent --assignee-id ... --title "...")
C=$(agora issue create --parent $parent --assignee-id ... --title "...")
D=$(agora issue create --parent $parent --assignee-id ... --title "...")
E=$(agora issue create --parent $parent --assignee-id ... --title "...")
agora dependencies add $C --target $A --kind blocks
agora dependencies add $D --target $B --kind blocks
agora dependencies add $D --target $C --kind blocks
agora dependencies add $E --target $D --kind blocks
```

### Issue-workflow agent first step

When agent picks up an assigned issue, the workflow prompt (in
CLAUDE.md, written by `renderIssueWorkflow`) instructs:

> First, run `agora issue get <id> --output json` and check the
> `blockedBy` array.
>
> - If empty → proceed with the work.
> - If non-empty AND every blocker has `status=done` → proceed.
> - Otherwise: post a single comment naming the unfinished blockers
>   ("waiting for I-12, I-13"), set `status=blocked`, and exit. The
>   server will re-enqueue you when the blockers resolve.

### Server unblock sweep

New file: `server/src/services/issue-unblock.ts`

```ts
export async function sweepUnblocked(workspaceId, resolvedIssueId): Promise<void>
```

Trigger: called from the issue PATCH handler whenever `status` changes
to `done` or `cancelled`.

Algorithm:
1. SELECT issues Y where `(Y, resolvedIssueId)` exists in
   `issue_dependency` with `type='blocks'`.
2. For each Y:
   - If Y.status !== 'blocked', skip (user moved it manually; respect that).
   - Else: check Y's other blockers — only proceed if ALL are now
     `done` or `cancelled`.
   - If all clear AND Y.assignee_kind='agent': set Y.status='todo'
     AND enqueueTaskForIssue(Y).
   - If all clear AND Y.assignee_kind='member': set Y.status='todo'
     (the human's inbox / kanban view will surface it).
3. Broadcast `issue.updated` so kanbans re-render.

This is best-effort — if it throws (DB hiccup, missing assignee),
log and move on; the sweep is rerunnable by re-finishing the resolved
issue or re-statusing the blocker manually.

## Out of scope (deferred)

- UI affordance for "set this issue to blocked" — agents do it via CLI;
  humans can use the existing status dropdown.
- Notification/email when unblock fires — already covered by existing
  WS invalidation + inbox.
- Auto-cycle detection at `dependencies add` time — server returns
  500 today if a cycle exists in queries; future hardening.

## Files touched

- `server/src/services/chat.ts` — extend `CHAT_ORCHESTRATOR_PRELUDE`
- `local/src/runtime-config.ts` — add blocked-by check to issue
  workflow section
- `server/src/services/issue-unblock.ts` — new
- `server/src/routes/issues.ts` — call sweepUnblocked on done/cancelled
- Tests for sweep + chat prelude shape

## Acceptance

1. Chat: ask "feature X", agent proposes a plan with `(depends on Y)`
   notation, after "ok" files parent + N children + `agora
   dependencies add` calls. Verified by reading task_message stream.
2. Issue: assign issue Y to an agent where Y is blocked-by I-12 (still
   `in_progress`). Agent's task picks up, posts comment "waiting on
   I-12", sets Y to `blocked`, exits.
3. Mark I-12 `done`. Server sweep → Y flips to `todo`, fresh task
   enqueued for Y's assignee. Agent picks up the new task and works
   the issue normally.

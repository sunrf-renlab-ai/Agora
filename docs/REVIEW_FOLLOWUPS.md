# Review follow-ups — TIER 2 (architectural)

Findings from the 2026-05-11 `/review` pass that need dedicated work — not auto-fixed in the same commit because they require design decisions or sit on hot paths where a careless refactor regresses something else.

Severity / confidence are from the specialist subagents (security, performance, testing, maintainability, data-migration, api-contract).

---

## CRITICAL — production correctness / cost

### 1. Claim handler N+1 cascade · `server/src/routes/daemon.ts:244` · perf 9/10

Claim does ~9-10 sequential DB round trips (`agent`, `issue`, `priorSession`, `triggerComment` + author, `workspace`, `project`, `projectResources`, `agentSkills`, `autopilotRun`, `autopilot`). On Render free CPU + Supabase pooler each hop is 20-50ms → claim p50 lands at 200-500ms.

**Fix:** wrap independent lookups in one `Promise.all`, run the dependent ones (comment author, project resources, autopilot) in a second wave. Two RTTs instead of ten.

### 2. `useTaskMessages` refetches full history every WS tick · `web/src/hooks/useTasks.ts:47` · perf 8/10

`task.messages_appended` fires every 2s while a task is running. Hook never passes `?since=<lastSeq>` so each tick re-downloads up to 200 rows per expanded `AgentRunCard` per viewer. Bandwidth scales N × M × 30/min.

**Fix:** track `lastSeq` in the query cache, request only new rows on the next tick, append via `queryClient.setQueryData` instead of invalidating. Server already supports the `since` param.

### 3. `task.messages_appended` fan-out is workspace-wide · `local/src/daemon.ts:20` · perf 8/10

The daemon flushes every 2s and emits a workspace-wide WS event. Every connected client in the workspace receives the frame, regardless of whether they're viewing that issue.

**Fix:** publish to a per-task channel (`task:<id>`) and subscribe only when an `AgentRunCard` is expanded. Falls back to a 5s flush interval if we keep workspace fan-out.

---

## Test gaps (specialist: testing)

### 4. `TaskMessageBuffer` has zero unit tests · `local/src/daemon.ts:299`

Genuinely tricky: re-entrant `flush()`, `unshift`-on-error retry preserving seq order, `BATCH_MAX=200` cap, threshold-vs-timer race.

**Fix:** extract `TaskMessageBuffer` to `local/src/task-message-buffer.ts` and add 5 tests (sequential seq, retry-on-500 preserves order, BATCH_MAX cap + recursion, concurrent flush serializes, `stop()` then manual flush).

### 5. New server endpoints untested

- `POST /api/daemon/tasks/:id/messages` — cross-runtime auth, idempotency on `(task_id, seq)`, `latestSeq` semantics
- `GET /api/workspaces/:wsId/tasks/:taskId/messages` — workspace isolation, `since` bounds, `limit` clamp, seq-asc order
- `POST /api/workspaces/:wsId/issues/:id/rerun` — 5 branches (unassigned / no runtime / archived agent / duplicate / happy)
- `POST/DELETE /api/workspaces/:wsId/issues/:issueId/labels[/:labelId]` — wrong-workspace label, idempotent re-add, broadcast
- `GET /api/workspaces/:wsId/autopilots/:id/runs/:runId` — URL-mismatched runId
- Manual `POST /trigger` body — empty body, payload round-trip, malformed JSON

Each is small to add. Cover both happy and error paths.

### 6. e2e covers only happy paths · `e2e/tests/feature-walkthrough.spec.ts`

No tests for 401 (missing auth), 403 (member touching owner-only), 404 (foreign workspace slug). A regression in middleware ordering would ship undetected.

---

## API contract polish (specialist: api-contract)

These are non-breaking improvements that should land before more clients start consuming the endpoints. All INFORMATIONAL.

| Route | Issue | Fix |
|---|---|---|
| `GET /tasks/:id/messages` | bare `TaskMessage[]` forecloses pagination metadata | Wrap in `{ messages, nextSince? }` or commit to bare-array forever |
| `POST /daemon/tasks/:id/messages` | `latestSeq` is batch-max not persisted-max | Compute via `SELECT MAX(seq)` after insert, or rename to `submittedLatestSeq` |
| `PUT /skills/:id/files` | collection PUT semantically upserts a single file | Rename to `POST /files` (upsert) or `PUT /files/:fileId` (replace one) |
| `POST /issues 409` | non-standard `{ error, candidates }` shape | Nest under `{ error, details: { candidates } }` so `err.error` parsing still works |
| `DELETE /subscribers` | always returns 200 even when no row matched | Return `rowsAffected` or `204` |

---

## Maintainability (specialist: maintainability)

### 7. File splits

- `local/src/daemon.ts` (723 lines) → extract `local/src/prompts.ts` (prompt builders) + `local/src/task-message-buffer.ts`. Leaves daemon.ts at ~350 lines focused on WS loop + claim/run.
- `local/src/runtime-config.ts` (479 lines) — `buildClaudeMd` is a single 398-line function. Split into per-section helpers (`renderAvailableCommands`, `renderWorkflow`, etc.).
- `server/src/routes/issues.ts` (702 lines) — extract `_issues-helpers.ts` for the JSON-shaping helpers.
- `server/src/routes/daemon.ts` (604 lines) — split into `daemon-runtime.ts` / `daemon-tasks.ts` / `daemon-skills.ts`.

### 8. Remaining i18n gaps

- `StatusBadge.tsx` — hardcoded English status labels
- `LabelPicker.tsx` — `+ Label`, `New label`, etc.
- `PinSidebar.tsx` + `PinToggle` — Pinned / Unpin / Pin to sidebar
- `IssueDetailView.tsx` — subscribe toasts (`Subscribed to issue`, `Unsubscribed from issue`, `Failed to update subscription`), fullscreen aria-labels, `Loading…`, `No description.`, `Unassigned`, `Unknown`

### 9. Failure-reason taxonomy

`local/src/daemon.ts:636` tags every claim/run failure as `agent_error` regardless of whether the failure was the agent or the daemon's own infra (network, JSON parse, child spawn). Misleads server-side diagnostics.

**Fix:** add `runtime_error` to the failure-reason enum and tag daemon-infra failures correctly.

### 10. Empty catches without breadcrumbs

`local/src/daemon.ts:495`, `local/src/runner.ts:115`, `local/src/runner.ts:142` — all swallow errors without even a `console.debug`. Debugging "why isn't my daemon claiming?" gets harder than it should.

**Fix:** log at debug level with the truncated raw frame / error so operators have a breadcrumb.

---

## Data model (specialist: data-migration)

### 11. `task_message.workspace_id` denormalization is unused

Column carries 16B + row overhead × every CLI event. Currently only used to populate the WS broadcast `workspaceId` — which is already available from the parent task row. Cascade FK is also redundant (workspace deletion already cascades through `agent_task_queue` → `task_message`).

**Fix:** drop the column (saves space + one cascade hop), or document the denormalization rationale if it's preparation for RLS / cross-workspace audit queries.

### 12. Journal timestamp anomaly

`supabase/migrations/meta/_journal.json` idx=2 has `when: 1746576573000` (May 2025) while siblings are Nov 2025. Drizzle replays by `idx` so runtime is unaffected, but external tooling that sorts by `when` will misorder by ~6 months.

**Fix:** re-stamp to a value between idx=1 and idx=3.

---

## Done in this commit (TIER 1)

- Drop duplicate `task_message_task_seq_idx` index (migration `20260511085505_drop_dup_task_msg_idx.sql`); schema now declares only `uniqueIndex`.
- `POST /issues/:id/rerun` returns `{ ok, taskId }` so CLI/web can reference the run.
- `POST /issues/:id/labels` returns 201 with `{ labelId, issueId, workspaceId }`.
- `DELETE /issues/:id/labels/:labelId` returns 204 No Content, matching every other DELETE in the codebase.
- Delete orphaned `web/src/components/agents/TaskProgressPanel.tsx` and `web/src/components/issues/MentionTextarea.tsx`.
- Extract `STRIP_COOKIE_NAMES` + cookie conversion to `e2e/scripts/_cookie-utils.ts`; both build + refresh scripts import from there.

# Skills page UX fixes — 2026-05-15

## Problem

Four issues with `web/src/app/[workspaceSlug]/skills/page.tsx` + `web/src/components/skills/LocalSkillsAutoScan.tsx`:

1. **Repeat-scan on every visit.** Each mount of `LocalSkillsAutoScan` fires a fresh `runtime_local_skill_list_request` against the daemon. Coming back to the page two minutes later costs another full scan, which is unnecessary churn — the local skills directory rarely changes between page views.
2. **`Promote` button reads as "already promoted".** Per-row + bulk buttons are `<Check /> Promote`. The leading `Check` icon visually says "✓ done", so users assume every row is already public when it isn't.
3. **Bulk action bar gets lost.** It renders inline below the skill list (`mt-3 ...`). With more than ~8 rows, selecting a skill and the bar scrolls off-screen.
4. **`Workspace` vs `Public` is ambiguous.** Labels are bare words. Users have asked whether selecting "workspace" means scoping to a project inside the workspace, or whether it means the whole workspace. Same confusion exists in the skill list rows (`s.visibility` is shown as raw text "workspace" / "public" / "private").

## Decisions

### 1. Cache scan results client-side (per-runtime localStorage)

- Key: `agora.skill-scan.${runtimeId}` → `{ requestId, ts }`.
- TTL: 5 minutes. If `Date.now() - ts < 5*60*1000`, restore the cached `scanRequestId` instead of triggering a new scan.
- Explicit `Rescan` button in the section header (icon `RotateCw`) — bumps the cache and re-fires `requestLocalSkillList`.
- Auto-rescan still happens, but only when stale. Same effect server-side: still creates a new request row when needed.
- No server change. (Server already keeps request history; a future improvement could be a "latest completed request per (runtime, user)" endpoint, but per-device localStorage is enough now.)

### 2. Replace `Check` with `ArrowUpFromLine`

- `lucide-react` has `ArrowUpFromLine` — an upward arrow from a base line, reads as "send up to the cloud / promote".
- Apply to per-row button and bulk button.
- Existing `Check` is reused for the visibility radio chip's selected state if needed (not currently used as a selection mark there).

### 3. Floating bottom action bar

- When `someSelected`, render the bulk bar as `fixed bottom-4 left-1/2 -translate-x-1/2 z-30` with `shadow-xl border border-gray-200 rounded-lg bg-white` per DESIGN.md dialog recipe.
- Add `pb-24` to the section container so the last row in the list isn't covered.
- Inside the bar: count + visibility radio + Promote button (same layout as today, just floated).
- Add `Esc` to clear selection (small affordance, no extra UI clutter).

### 4. Workspace/Public clarity

Three changes — UI only, no schema change:

**a) Visibility radio in the bulk bar:**
- "Workspace" → main label `Workspace` + secondary `members only`. Hover tooltip: "Anyone in this workspace can install and use it."
- "Public" → main label `Public` + secondary `anyone`. Hover tooltip: "Anyone on Agora can find and install it from the public catalog."

**b) Skill row in `page.tsx`:**
- Replace plain `{s.visibility}` text with a colored chip:
  - `private` → gray pill, `Only you`
  - `workspace` → indigo pill, `Workspace`
  - `public` → emerald pill, `Public`
- Keep description after the chip.

**c) `SkillForm.tsx`:**
- Replace the bare `<select>` with the same three labeled options ("Only you" / "Workspace" / "Public"). Use a styled segmented control like the bulk bar, for consistency.

### Out of scope (deliberately)

- **Project-scoped visibility.** Skills currently bind workspace-wide. Adding a project scope = schema change (`projectId UUID NULL`, FK + index), agent-skill resolution change, migration. Not worth it until users actually have multiple projects with different skill needs. Tracked here as future work; do not implement now.
- **Public catalog browse.** The "public" visibility exists in the schema but there's no public catalog UI to install from someone else's `public` skill. Out of scope.

## Files touched

| File | Change |
|---|---|
| `web/src/components/skills/LocalSkillsAutoScan.tsx` | localStorage cache, Rescan button, ArrowUpFromLine icons, floating action bar, visibility radio with subtitles |
| `web/src/app/[workspaceSlug]/skills/page.tsx` | Colored visibility chip in skill row |
| `web/src/components/skills/SkillForm.tsx` | Three-option segmented visibility control + clear labels |

## Verification

- `bun --filter web typecheck` clean
- `bunx biome check --write` on modified files clean
- Manual: 1) reload page twice within 5min → second load reuses cached scan; 2) Rescan button triggers fresh scan; 3) per-row + bulk buttons no longer show ✓; 4) select 1+ rows → action bar floats at bottom of viewport, not inside the section; 5) chips on each row clearly state Only you / Workspace / Public.

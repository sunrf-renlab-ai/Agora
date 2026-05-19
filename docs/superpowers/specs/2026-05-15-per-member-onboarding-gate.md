# Per-member onboarding gate — 2026-05-15

## Problem

When someone accepts a workspace invite, they land directly in the
workspace and are never prompted to connect their own machine / set up
their own agent.

Root cause — `web/src/app/[workspaceSlug]/layout.tsx`:

```js
const onlineRuntime = runtimes.some((r) => r.online);   // ANY runtime in the workspace
const hasAgent = agents.length > 0;                     // ANY agent in the workspace
```

The onboarding gate is **workspace-scoped**. When an invited member joins
a workspace the owner already set up, `hasAgent` is already true and an
`onlineRuntime` already exists — so the gate passes and the new member
skips onboarding entirely. They have no daemon of their own, so they
can't actually run agents.

Agora's model is "you bring the runtime" — every member runs `agorad` on
their own machine, and agents are bound to a specific `runtimeId`. The
gate must therefore be **per-member**, not per-workspace.

## Decision

Make the gate per-member: a member may use the workspace only once
**they personally** have an online runtime AND own at least one agent.

Data is already sufficient — no schema or new endpoint needed:
- `runtimes` JSON exposes `memberId` (runtime → member).
- `agents` JSON exposes `ownerId` (agent → `users.id`).
- `GET /api/workspaces/:id/members` returns each member's `id` + `userId`.

Client maps current user → their member id via the members list.

## Changes

### 1. `layout.tsx` — per-member gate

- Fetch current user (`api.getMe`) → `meId`.
- Load members (`useMembers`) → `myMemberId = members.find(m => m.userId === meId)?.id`.
- Gate:
  ```js
  const myOnlineRuntime = runtimes.some((r) => r.online && r.memberId === myMemberId);
  const myAgent = agents.some((a) => a.ownerId === meId);
  needsOnboarding = !myOnlineRuntime || !myAgent;
  ```
- `gatePending` also waits on `meId` known + members fetched, so we don't
  bounce on a cold-load empty members array.

### 2. `onboarding/page.tsx` — per-member scoping

Three spots currently look workspace-wide and would misfire for an
invited member (e.g. auto-create an agent on the *owner's* runtime):

- `onlineRuntime` detection → require `r.memberId === myMemberId`.
- Skip-agent-creation guard `agents.length > 0` → `agents.some(a => a.ownerId === me.id)`.
- "Already onboarded? Bounce" effect → same per-member runtime + agent check.

Load members via `useMembers` to resolve `myMemberId`.

### 3. `invite/[token]/page.tsx` — route into the workspace after accept

`acceptInvitation` returns `{ workspaceId }`. After accept, look up the
workspace slug from `api.listWorkspaces` and `router.push(/${slug})`.
The per-member gate then immediately bounces the new member to
`/${slug}/onboarding`. (Falls back to `/workspaces` if the slug can't be
resolved.)

## Out of scope

- Role-based gating (viewers skipping onboarding) — every member is
  gated for now; revisit if a non-agent role is added.
- Exposing `userId` directly on the runtime JSON — client-side mapping
  via the members list is enough for 2-10 person teams.

## Verification

- `bun --filter web typecheck` clean, `bun --filter web build` clean.
- Manual: invited member accepts → lands in workspace → immediately
  redirected to `/onboarding` showing the install command, even though
  the workspace owner already has agents online. Owner / already-set-up
  members are unaffected.

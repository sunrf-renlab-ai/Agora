# Human agent-invocation boundary — 2026-05-19

## Problem

A human can currently start work on **any** workspace agent — including
agents owned by other members. That conscripts the other member's
machine: their daemon runs the task, their model credentials and quota
are spent, their compute is used. A human picking another person's
agent from a dropdown is the wrong model.

Routing work across members is an **AI** decision: the orchestrator
decomposes a task and assigns sub-issues to whichever agents fit. A
human should only be able to manually invoke **their own** agent.

Current holes — every path that enqueues an agent task with no
ownership check:
- `issues.ts` POST / PATCH — assigning `assigneeKind:agent` enqueues a
  task on that agent's runtime.
- `issues.ts` `/rerun` — re-enqueues the issue's assigned agent.
- `comments.ts` — an `@agent` mention enqueues a task.
- `quick-create.ts` — has a partial check (blocks *private* agents owned
  by others) but a workspace-visible agent owned by someone else still
  goes through.

## The rule

A request may invoke an agent (enqueue a task on it) iff:

```
isAgentCall  OR  agent.ownerId === user.id
```

- **`isAgentCall`** — the request carries `taskAuth` (a daemon-spawned
  agent CLI authenticated by a task JWT). This is the orchestrator / an
  agent routing work. Allowed to invoke any agent.
- **Human request** — authenticated as a user (Supabase JWT / PAT), no
  `taskAuth`. May only invoke an agent it owns.

`taskAuth` vs no-`taskAuth` is exactly the "AI chose" vs "human chose"
discriminator — it needs no new field.

Agent `visibility` (`workspace` / `private`) is unchanged: it still
governs who can *see* an agent in the roster. Ownership — not visibility
— governs who can manually *invoke* it. An orphaned agent
(`ownerId === null`) is invokable only by AI.

## Changes

### Server

New helper `server/src/lib/agent-invoke.ts`:

```
humanOwnsAgent(agent, userId): boolean   // agent.ownerId === userId
```

Each enqueue path resolves `isAgentCall = !!c.get("taskAuth")` and
rejects (`403`, message: "You can only assign work to your own agents —
cross-member routing is handled by the orchestrator.") when
`!isAgentCall && !humanOwnsAgent(agent, user.id)`:

- `issues.ts` POST — before the `assigneeKind:agent` enqueue.
- `issues.ts` PATCH — before the reassignment enqueue.
- `issues.ts` `/rerun` — before re-enqueuing the issue's assigned agent.
- `quick-create.ts` — replace the partial `visibility`-based check with
  the ownership rule.
- `comments.ts` `@agent` trigger — filter the mentioned-agent set:
  human-authored comments only trigger agents the author owns; the
  comment still posts, non-owned mentions just don't enqueue. Agent-
  authored comments (taskAuth) trigger any mentioned agent.

Note: an issue can still be *assigned* to any agent by the orchestrator
(taskAuth). The boundary is on **who enqueues**, not on the assignee
column. A human reassigning *away from* an agent, or to a human, is
always fine.

### Web

- `AssigneePicker.tsx` — takes a new `currentUserId` prop; the Agents
  optgroup lists only `agent.ownerId === currentUserId`. If the issue's
  current assignee is a non-owned agent (orchestrator-assigned), include
  it as the selected option so the control still displays correctly,
  but don't offer other members' agents.
- `MentionList.tsx` — the `@`-autocomplete lists only the current user's
  own agents (human members are still mentionable). Other members'
  agents drop out of the suggestion list.

## Out of scope

- Changing the `visibility` enum or roster visibility.
- Letting admins/owners bypass the rule — it applies to all humans
  uniformly (it is about whose machine runs the work, not permissions).
- Any change to how the orchestrator routes — it already assigns via
  taskAuth-authenticated CLI calls and stays allowed.

## Verification

- `bun run --filter '*' typecheck`, `bun --filter web build` clean.
- `bun --filter server test` passes.
- New tests: a human (PAT) assigning an issue to another member's agent
  → 403; to their own agent → 200 + task enqueued; an agent (task JWT)
  assigning to any agent → 200; quick-create to a non-owned agent as a
  human → 403.

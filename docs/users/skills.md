# Skills

A **skill** is a reusable, named bundle of instructions an agent inlines before each run. Skills compound your team's knowledge: the deploy procedure, the code review checklist, the database migration steps — write each once, attach to as many agents as you want.

Agora's skill model is compatible with Claude Code's `~/.claude/skills/` layout: a directory containing a `SKILL.md` plus optional supporting files. You can author skills in the web UI or import existing ones from disk or a URL.

## Anatomy

A skill has:

- **Name** — short identifier, kebab-case (`deploy-staging`).
- **Description** — one-line summary shown in pickers.
- **Content** — the SKILL.md body, Markdown.
- **Files** (optional) — additional context files included verbatim.

When an agent runs a task, every bound skill's content is prepended to the prompt. The agent treats them like extended instructions.

## Create a skill

Settings → **Skills** → **New skill**.

```markdown
---
description: Deploy the staging environment safely
---

# Deploy staging

1. Confirm CI is green on `main`.
2. Run `./scripts/deploy.sh staging`.
3. Watch the health check at https://staging.example.com/healthz.
4. If the health check fails for 90s, run `./scripts/rollback.sh staging`.
```

You can also do this from the CLI:

```bash
agora skill create --name deploy-staging \
  --description "Deploy the staging environment safely" \
  --content "$(cat ./skill.md)"
```

## Bind a skill to an agent

Two paths:

- **Web**: Settings → Agents → click an agent → **Skills** tab → multi-select.
- **CLI**: `agora agent skills set <agent-id> <skill-id-1> <skill-id-2>` (replaces the whole set).

Skills bound to an agent apply to **every** task that agent runs.

## URL import

Pull a skill from a public URL — useful for sharing skills across workspaces or installing community skills.

```bash
agora skill import --url https://example.com/path/to/skill.md
```

Or in the web UI: Settings → Skills → **Import** → paste URL.

The server fetches the URL, validates it's Markdown, and creates a workspace-local copy. Subsequent edits don't sync back; this is a one-time pull.

## Local discovery

If you have skills already authored in `~/.claude/skills/` on a machine running an `agorad` daemon, the daemon can surface them to the workspace.

1. Settings → **Skills** → **Discover** → pick the runtime.
2. The daemon enumerates `~/.claude/skills/*/SKILL.md` and reports them.
3. Pick which ones to import; they're created as workspace skills.

To push the other direction (workspace skill → local disk for editing in your IDE), enable **Sync to runtime** on the skill. The daemon then writes the latest content into `~/.claude/skills/<name>/SKILL.md` whenever it changes.

## Updating

```bash
agora skill update <id> --content "$(cat ./new-skill.md)"
```

Or web UI: edit in place. All bound agents pick up the new content on their next run.

## Search

Skills support semantic search via pgvector. The command palette (`Cmd/Ctrl+K`) ranks skills by embedding similarity to your query.

## Tips

- Keep skills **task-shaped**, not topic-shaped. "Deploy staging" beats "Deployment knowledge".
- Don't dump the entire codebase into a skill. Reference paths the agent can read with its tools.
- Use the description field — it's all the picker shows by default.

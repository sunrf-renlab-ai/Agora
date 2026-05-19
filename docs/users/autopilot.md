# Autopilot

Autopilot fires agents on triggers — scheduled cron jobs, or comments matching a regex. Use it to automate recurring work (daily standups, weekly retros, dependency upgrades) or to give your team a `@bot` mention that does something.

## Concepts

An **autopilot** binds:

- A **trigger** (when to fire)
- An **agent** (who to dispatch)
- A **prompt template** (what context to give them)

Each fire produces a normal task on the agent's runtime — same lifecycle as a manually-dispatched issue.

## Schedule trigger (cron)

Settings → **Autopilots** → **New autopilot** → **Schedule**.

| Field | Example |
|---|---|
| **Name** | `Daily standup digest` |
| **Cron** | `0 9 * * 1-5` (9am weekdays) |
| **Timezone** | `America/Los_Angeles` |
| **Agent** | Pick from dropdown |
| **Prompt** | Markdown template (see below) |

The server scheduler ticks every 30 seconds and dispatches any autopilot whose `next_fire_at` has passed. Intervals are computed by `cron-parser`, so all standard cron syntax works.

> Schedules are **per workspace** in their own timezone. The server stores everything in UTC; you only see the timezone in the editor.

## Comment trigger

Same flow, pick **Comment trigger** instead.

| Field | Example |
|---|---|
| **Pattern** | `^@bot fix this` (regex) |
| **Scope** | `Any issue` or `Project: Engineering` |
| **Agent** | Pick from dropdown |

When someone comments matching the pattern, the autopilot fires immediately with the comment text and surrounding issue as context.

## Prompt template

The prompt is Markdown with `{{ variable }}` interpolation. Available variables depend on trigger:

**Schedule trigger:**

- `{{ workspace.name }}`, `{{ workspace.slug }}`
- `{{ now }}` (ISO timestamp at fire time)
- `{{ trigger.name }}`

**Comment trigger:**

- All of the above, plus:
- `{{ comment.body }}`, `{{ comment.author.name }}`
- `{{ issue.title }}`, `{{ issue.identifier }}`, `{{ issue.url }}`
- `{{ matches[1] }}` ... — capture groups from the regex.

Example:

```markdown
You are running the daily standup digest for {{ workspace.name }}.

Look at issues moved into `done` since yesterday, summarize them in 3 bullets,
and post the summary to the `#standup` Slack channel via the MCP slack tool.
```

## Run history

Settings → Autopilots → click an autopilot → **Runs** tab. Shows last 100 fires with status, duration, and a link to the underlying task.

## Pause / disable

Toggle **Enabled** on the autopilot detail page. A disabled autopilot keeps its schedule but doesn't fire. Useful for debugging without losing your config.

## Deleting

Deleting an autopilot doesn't kill in-flight runs — they finish on their own. But no new runs will fire.

## Limits

- Schedule resolution: **30 seconds**. Don't expect a `* * * * *` cron to fire to the millisecond.
- Cron drift: if the server is down for 10 minutes, a missed fire is **skipped**, not back-filled. (We avoid surprise floods of catch-up work.)
- Comment triggers fire for any matching comment, including from agents. To avoid loops, scope your pattern carefully (e.g. require a `@bot` mention).

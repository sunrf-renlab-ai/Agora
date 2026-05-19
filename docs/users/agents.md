# Agents

An **agent** is a configured AI worker that lives in your workspace. It has a name, an avatar, instructions, and runs on a **runtime** (a machine with an agent CLI installed). Once created, you assign issues to it like any other teammate.

## Concepts

- **Runtime** — a machine that can execute agent tasks. It runs the `agorad` daemon and reports which CLIs (`claude`, `codex`, `gemini`, etc.) it has on PATH.
- **Agent** — a workspace-level config: which runtime, which CLI, what instructions, what skills.
- **Task** — one dispatch of one issue to one agent. Has a queued/running/completed/failed lifecycle.

## 1. Connect a runtime

Settings → **Runtimes** → **New runtime**. Pick a name (e.g. `mac-laptop`, `cloud-builder-1`). Click **Create**.

Agora prints a one-time setup command:

```bash
agorad setup \
  --server https://your-agora-host \
  --workspace 5b8e... \
  --token mt_... \
  --runtime rt_...
```

Run this on the machine you want to register. Then start the daemon:

```bash
agorad daemon start
```

The daemon connects to the WS hub, registers itself, and reports the CLIs on PATH. Within a couple of seconds the **Runtimes** page in the web app flips the runtime to **online**.

> The daemon is just `bun run` of `local/src/daemon.ts`. For long-running deployments, run it under a process manager (systemd, launchd, pm2). The daemon auto-reconnects if the WS hub blips.

## 2. Create an agent

Settings → **Agents** → **New agent**.

| Field | What it does |
|---|---|
| **Name** | Display name on the board. Pick something descriptive (`backend-bot`, `docs-writer`). |
| **Runtime** | Which machine runs this agent's tasks. |
| **CLI kind** | `claude_code`, `codex`, `gemini`, `copilot`, etc. Must be available on the runtime's PATH. |
| **Instructions** | The agent's "personality" — system prompt prepended to every task. Markdown supported. |
| **Max concurrent tasks** | How many tasks this agent can run in parallel on its runtime. Default `1`. |
| **MCP config** | Optional JSON of MCP servers (filesystem, github, etc.) merged into each task. |
| **Skills** | Multi-select from workspace skills — see [Skills](./skills.md). |

Save. The agent appears in assignee pickers everywhere.

## 3. Dispatch

Three ways to dispatch:

1. **Assign an issue to the agent.** This enqueues a task with the issue ID as context. The agent reads the issue, comments on progress, updates status.
2. **Direct chat** — see [Chat](./chat.md). One-off task with no issue.
3. **Autopilot** — recurring or comment-triggered. See [Autopilot](./autopilot.md).

## Watching a run

Open the issue → scroll to **Activity** → expand the run row. You'll see:

- **Stdout / stderr** streamed live.
- **Tool calls** (file edits, shell commands) the agent made.
- **Status transitions** the agent fired.
- **Final result** (exit code, duration, token usage if the CLI reports it).

If the runtime crashes mid-run, Agora's recovery sweep marks the task `failed` with `failure_reason: runtime_recovery` within ~90 seconds and the issue stays in `in_progress` until you either reassign or manually move it.

## Listing tasks

CLI:

```bash
agora agent tasks <agent-id>      # last 50 runs
agora runs --agent <agent-id>     # alias
```

Web: Settings → Agents → click the agent → **Runs** tab.

## Editing an agent

Click the agent in Settings → Agents → edit any field. Changes apply to the next dispatched task; an in-flight run keeps its original config.

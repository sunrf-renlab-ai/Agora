# `agora` CLI

The `agora` CLI lets you drive a workspace from the terminal — useful for scripts, agents that want to call back into Agora, or any time you don't want to open the browser.

## Install

The CLI is the `cli/` workspace. From a checkout:

```bash
cd /path/to/agora
bun install
bun link --filter cli
agora --help
```

For a packaged install (once published):

```bash
bun install -g @agora/cli
```

## Authenticate

Set three environment variables. The simplest place is `~/.agorarc` or your shell init:

```bash
export AGORA_SERVER_URL=https://your-agora-host
export AGORA_TOKEN=ag_pat_8f3a...        # see Settings → Tokens
export AGORA_WORKSPACE_ID=<workspace-uuid>
```

Verify:

```bash
agora version
agora issue list
```

> The CLI also runs **inside agent tasks**. The daemon mints a per-task JWT and injects all three vars before spawning the agent CLI, so calls like `agora issue create` from inside a Claude Code task just work.

## Commands

### `agora issue`

```bash
agora issue list                                # default columns
agora issue list --status in_progress
agora issue list --json                         # machine-readable

agora issue get ENG-42                          # full issue (JSON)
agora issue get <uuid>

agora issue create --title "Fix login redirect" \
  --description "Repro: ..." \
  --priority high \
  --status todo \
  --assignee-kind member --assignee-id <user-id>

agora issue status ENG-42 in_progress           # transition
agora issue assign ENG-42 --kind agent --target <agent-id>

agora issue search "auth bug"
agora issue search "auth" --offset 50
```

### `agora issue comment`

```bash
agora issue comment list ENG-42
agora issue comment add ENG-42 --content "Fix is in PR #123."
```

### `agora issue subscriber`

```bash
agora issue subscriber list ENG-42
agora issue subscriber add ENG-42        # subscribe yourself
agora issue subscriber remove ENG-42
```

### `agora agent`

```bash
agora agent list
agora agent get <agent-id>
agora agent tasks <agent-id>             # last 50 task runs

agora agent skills list <agent-id>
agora agent skills set <agent-id> <skill-id-1> <skill-id-2>
```

### `agora runs`

Alias for `agent tasks`, scoped to the calling agent if `AGORA_AGENT_ID` is set:

```bash
agora runs                               # uses AGORA_AGENT_ID
agora runs --agent <agent-id>
```

### `agora skill`

```bash
agora skill list
agora skill get <skill-id>

agora skill create --name deploy-staging \
  --description "Deploy the staging env" \
  --content "$(cat ./skill.md)"

agora skill update <skill-id> --content "$(cat ./skill.md)"
agora skill delete <skill-id>

agora skill import --url https://example.com/skill.md
```

### `agora version`

```bash
agora version
# agora cli 0.0.1
```

## Output formatting

Most commands accept `--json` for machine-readable output. List commands default to a tab-separated tabular layout for grepping; get commands default to JSON.

## Exit codes

- `0` — success
- `2` — bad usage (missing required option, invalid combo)
- non-zero — propagated from the HTTP error

The full HTTP body is printed to stderr on failure, so `agora ... 2>err.log` captures the server's error message verbatim.

## Tips

- Set `AGORA_AGENT_ID` in agent task env so `agora runs` works without flags. The daemon does this automatically.
- Pipe to `jq` for JSON munging: `agora issue list --json | jq '.[] | select(.priority=="high")'`.
- The CLI doesn't cache anything. Every call hits the server. If you're scripting heavy automation, batch via the HTTP API directly.

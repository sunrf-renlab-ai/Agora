import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// TaskContext is the slice of task data we render into CLAUDE.md before the
// agent CLI starts. Fields are optional so
// we can call buildClaudeMd with whatever subset the server happened to send,
// and the renderer just elides absent sections.
export interface TaskContext {
  agentId?: string;
  agentName?: string;
  agentInstructions?: string;
  agentSkills?: Array<{ name: string }>;
  /** Workspace-shared knowledge docs (workspace_knowledge_doc rows). The
   *  daemon-side renderer inlines them into CLAUDE.md so the agent has
   *  the team's documented FAQs / runbooks / decisions in context
   *  without doing tool calls. Capped per-doc + total via the renderer. */
  knowledgeDocs?: Array<{ kind: string; title: string; content: string }>;
  /** Other agents in this workspace (excluding self). Rendered as a "Team
   *  Agents" section in CLAUDE.md so the agent immediately knows who else
   *  is on the team and can route work / @mention without first having to
   *  run `agora agent list`. Members trust each other inside a workspace
   *  by design — the snippet of `instructions` is the "what's this agent
   *  for" signal that makes routing decisions possible. */
  teamAgents?: Array<{
    id: string;
    name: string;
    description: string;
    instructions: string;
    cliKind: string;
    model: string | null;
    ownerId: string | null;
    /** SKILL.md bindings — the strongest "what does this agent know
     *  how to do" signal. Names only (the SKILL.md bodies live on disk
     *  and would balloon CLAUDE.md). */
    skills: string[];
    /** Top-level keys of the teammate's mcpConfig — i.e. which external
     *  tools they're wired to (linear / postgres-prod / slack / ...).
     *  Credentials and command lines stay on the server. */
    mcpServers: string[];
    /** null when the agent has no runtime assigned yet. */
    runtimeOnline: boolean | null;
    /** Active task count: queued + dispatched + running. */
    loadActive: number;
    /** Per-state cap (`maxConcurrentTasks`); `loadActive >= loadCap`
     *  means the teammate is saturated and should not be routed to. */
    loadCap: number;
  }>;
  issueId?: string;
  triggerCommentId?: string;
  chatSessionId?: string;
  quickCreatePrompt?: string;
  autopilotRunId?: string;
  autopilotId?: string;
  autopilotTitle?: string;
  autopilotDescription?: string;
  autopilotSource?: string;
  autopilotTriggerPayload?: string;
  repos?: Array<{ url: string }>;
  projectId?: string;
  projectTitle?: string;
  projectResources?: Array<{ resourceType: string; resourceRef: unknown; label?: string }>;
}

// formatProjectResource renders one resource as a human-readable bullet.
// Unknown types fall back to JSON-stringifying the ref so the agent at least
// sees what was attached.
function formatProjectResource(r: {
  resourceType: string;
  resourceRef: unknown;
  label?: string;
}): string {
  const label = r.label;
  if (r.resourceType === "repo") {
    // Agora's project_resource for repos stores the URL directly in
    // resource_ref (text column).
    const url = typeof r.resourceRef === "string" ? r.resourceRef : JSON.stringify(r.resourceRef);
    let out = `**Repo**: ${url}`;
    if (label) out += ` — ${label}`;
    return out;
  }
  if (r.resourceType === "url") {
    const url = typeof r.resourceRef === "string" ? r.resourceRef : JSON.stringify(r.resourceRef);
    let out = `**URL**: ${url}`;
    if (label) out += ` — ${label}`;
    return out;
  }
  if (r.resourceType === "doc") {
    const ref = typeof r.resourceRef === "string" ? r.resourceRef : JSON.stringify(r.resourceRef);
    let out = `**Doc**: ${ref}`;
    if (label) out += ` — ${label}`;
    return out;
  }
  const ref = typeof r.resourceRef === "string" ? r.resourceRef : JSON.stringify(r.resourceRef);
  let out = `**${r.resourceType}**: \`${ref}\``;
  if (label) out += ` — ${label}`;
  return out;
}

// Agent Identity — emit even when only one of name/id/instructions is
// present so a misrouted @mention still has a name to ground itself with.
function renderAgentIdentity(ctx: TaskContext, parts: string[]): void {
  if (!(ctx.agentName || ctx.agentId || ctx.agentInstructions)) return;
  parts.push("## Agent Identity\n");
  if (ctx.agentName) {
    const idSuffix = ctx.agentId ? ` (ID: \`${ctx.agentId}\`)` : "";
    parts.push(`**You are: ${ctx.agentName}**${idSuffix}\n`);
  } else if (ctx.agentId) {
    parts.push(`**Agent ID:** \`${ctx.agentId}\`\n`);
  }
  if (ctx.agentInstructions) {
    parts.push(`${ctx.agentInstructions}\n`);
  }
}

// Available Commands — only commands that exist in the agora CLI today
// (verified against cli/src/cmd-*.ts). Comments live under
// `agora issue comment` because cli/src/index.ts mounts commentCmd as a
// subcommand of issueCmd.
function renderAvailableCommands(parts: string[]): void {
  parts.push("## Available Commands\n");
  parts.push(
    "**Always use `--output json` for read commands** to get structured data with full IDs.\n",
  );
  parts.push("### Read");
  parts.push(
    "- `agora issue get <id> --output json` — Get full issue details (title, description, status, priority, assignee).",
  );
  parts.push(
    "- `agora issue list [--status X] [--priority X] [--assignee <name> | --assignee-id <uuid>] [--project <id>] [--limit N] [--offset N] --output json` — List issues in the workspace.",
  );
  parts.push(
    "- `agora issue search <query> [--limit N] [--offset N] [--include-closed] --output json` — Full-text search issues.",
  );
  parts.push("- `agora issue runs <id> --output json` — List execution runs for an issue.");
  parts.push(
    "- `agora issue comment list <issue-id> [--limit N] [--since <iso>] --output json` — List comments on an issue (paginated; includes comment ids and parent links for threading).",
  );
  parts.push(
    "- `agora issue subscriber list <issue-id>` — List members/agents subscribed to an issue.",
  );
  parts.push("- `agora label list --output json` — List all labels defined in the workspace.");
  parts.push("- `agora label get <id> --output json` — Get a single label.");
  parts.push(
    "- `agora workspace list --output json` — List workspaces visible to the current account.",
  );
  parts.push(
    "- `agora workspace get [id] --output json` — Get workspace details (defaults to the current workspace).",
  );
  parts.push(
    "- `agora workspace members [id] --output json` — List workspace members (user IDs, names).",
  );
  parts.push("- `agora agent list --output json` — List agents in the workspace.");
  parts.push("- `agora agent get <id> --output json` — Get agent details.");
  parts.push("- `agora agent tasks <id> --output json` — List recent tasks for an agent.");
  parts.push(
    "- `agora agent skills list <agent-id> --output json` — List skill bindings for an agent.",
  );
  parts.push("- `agora skill list` / `agora skill get <id>` — List or fetch skill definitions.");
  parts.push("- `agora skill files list <skill-id>` — List supporting files attached to a skill.");
  parts.push("- `agora attachment download <id> [-o <dir>]` — Download an attachment file by ID.");
  parts.push(
    "- `agora runs [--agent <id>] --output json` — List recent task runs for the current (or specified) agent.\n",
  );

  parts.push("### Write");
  parts.push(
    '- `agora issue create --title "..." [--description <md> | --description-stdin] [--priority X] [--status X] [--assignee-kind member|agent --assignee-id <uuid>] [--parent <issue-id>] [--project <id>] [--due-date <iso>]` — Create an issue. For multi-line descriptions, use `--description-stdin` and pipe a HEREDOC.',
  );
  parts.push(
    '- `agora issue update <id> [--title X] [--description <md> | --description-stdin] [--priority X] [--status X] [--assignee-id <uuid>] [--project <id>] [--parent <issue-id>] [--due-date <iso>]` — Update one or more fields. Pass `--parent ""` to clear the parent.',
  );
  parts.push(
    "- `agora issue status <id> <status>` — Shortcut for flipping status (todo, in_progress, in_review, done, blocked, backlog, cancelled).",
  );
  parts.push(
    "- `agora issue assign <id> --to-id <uuid> --kind <member|agent>` / `--unassign` — Reassign or clear the assignee.",
  );
  parts.push("- `agora issue rerun <id>` — Re-queue the most recent run for an issue.");
  parts.push(
    '- `agora issue escalate <id> --reason "..."` — Hand the issue to a human. Use ONLY when no agent (including you) can complete it: it needs human credentials/secrets, a human decision or judgment call you cannot make, or an offline/manual action. Moves the issue to `blocked` and sends an action-required notification to the workspace\'s humans. Do NOT use it to dodge hard-but-doable work, and never fake completion instead of escalating.',
  );
  parts.push(
    "- `agora issue label add <issue-id> <label-id>` / `agora issue label remove <issue-id> <label-id>` — Attach / detach labels.",
  );
  parts.push(
    "- `agora issue subscriber add <issue-id> [--user-id <uuid> --kind <member|agent>]` / `agora issue subscriber remove <issue-id> [...]` — Subscribe or unsubscribe a member/agent.",
  );
  parts.push(
    "- `agora issue comment add <issue-id> --content-stdin [--parent <comment-id>] [--attachment <path>]` — Post a comment. Agent-authored comments must always pipe content via stdin, even for short replies. `--attachment` may be repeated.",
  );
  parts.push(
    "  - **For comment content, you MUST pipe via stdin; this is mandatory for any multi-line content (paragraphs, code blocks, backticks, quotes).** Do not use inline `--content` and do not write `\\n` escapes. Use a HEREDOC:",
  );
  parts.push("");
  parts.push("    ```");
  parts.push("    cat <<'COMMENT' | agora issue comment add <issue-id> --content-stdin");
  parts.push("    First paragraph.");
  parts.push("");
  parts.push('    Second paragraph with `code` and "quotes".');
  parts.push("    COMMENT");
  parts.push("    ```");
  parts.push("");
  parts.push(
    "  - The same rule applies to `--description` on `agora issue create` / `agora issue update` — use `--description-stdin` and pipe a HEREDOC for any multi-line description.",
  );
  parts.push("- `agora issue comment delete <issue-id> <comment-id>` — Delete a comment.");
  parts.push(
    '- `agora label create --name "..." --color "#hex"` / `agora label update <id>` / `agora label delete <id>` — Manage workspace labels.',
  );
  parts.push(
    '- `agora skill create --name "..." [...]` / `agora skill update <id>` / `agora skill delete <id>` / `agora skill import` — Manage workspace skills.',
  );
  parts.push(
    "- `agora agent skills set <agent-id> [skillIds...]` — Replace the skill bindings for an agent.\n",
  );

  // Everything else surfaced as a compact directory. Each top-level command
  // has its own --help with subcommand flags. Listing them once here so
  // agents know they exist; full flag enumeration would 4x this section.
  parts.push("### Everything else (run `agora <cmd> --help` for subcommands and flags)");
  parts.push("- `agora me get` / `agora me update` — Current user identity and profile.");
  parts.push(
    "- `agora inbox list [--unread] [--archived]` / `inbox read <id>` / `inbox archive <id>` / `inbox mark-all-read` / `inbox archive-all` — Notifications.",
  );
  parts.push(
    "- `agora projects list/get/create/update/delete` (+ `projects resource add/remove`) — Workspace projects and project↔resource bindings.",
  );
  parts.push(
    "- `agora dependencies list [--issue <id>]` / `dependencies add <issue> --target <issue> --kind <blocks|related>` / `dependencies remove` — Issue dependency graph.",
  );
  parts.push("- `agora pins list` / `pins add <itemId>` / `pins remove <pinId>` — Workspace pins.");
  parts.push("- `agora activity list <issueId>` — Activity feed for an issue.");
  parts.push(
    "- `agora runtimes list/get/delete` — Daemon runtime health (use when debugging 'why isn't this task picking up').",
  );
  parts.push(
    "- `agora autopilots list/get/create/update/delete` (+ `fire <id>`, `runs <id>`, `trigger {add,update,remove}`) — Automation.",
  );
  parts.push(
    "- `agora knowledge list/get/create/update/delete` — Workspace knowledge base entries (decisions, FAQs, runbooks, onboarding, general).",
  );
  parts.push(
    "- `agora chat list/create/rename/delete` (+ `chat messages <id>`, `chat send <id> --content-stdin`) — Vega chat sessions and messages.",
  );
  parts.push(
    "- `agora reaction issue {list,add,remove} <issueId> --emoji X` / `agora reaction comment {list,add,remove} <commentId> --emoji X` — Emoji reactions.",
  );
  parts.push(
    "- `agora attachment upload <path>` / `attachment list` / `attachment download <id>` / `attachment delete <id>` — Attachments (upload is the 3-phase signed-URL flow; just give a local file path).",
  );
  parts.push(
    "- `agora member list/add/update/remove` — Workspace members (humans/agents joined to this workspace).",
  );
  parts.push(
    "- `agora invitation list/get/accept/decline <token>` — Pending workspace invitations (invitee side).",
  );
  parts.push("- `agora pat list/create/revoke` — Personal access tokens.");
  parts.push("- `agora feedback list/create` — Product feedback.");
  parts.push(
    "- `agora notif get` / `notif set --key X --value <true|false>` — Notification preferences.",
  );
  parts.push(
    "- `agora connection list/start <kind>/remove <kind>` — Third-party data source connections (OAuth).\n",
  );
}

// Repositories — only when the workspace has any. Agora doesn't yet ship
// an `agora repo checkout` command, so we surface URLs only;
// the agent can git-clone or use whatever sandbox the runtime provides.
function renderRepos(repos: TaskContext["repos"], parts: string[]): void {
  if (!repos || repos.length === 0) return;
  parts.push("## Repositories\n");
  parts.push("The following code repositories are available in this workspace:\n");
  for (const repo of repos) {
    parts.push(`- ${repo.url}`);
  }
  parts.push("");
  parts.push(
    "Clone whichever repos you need into the working directory. The agora CLI does not yet ship a `repo checkout` shortcut — use git directly.\n",
  );
}

// Project Context — only when the issue belongs to a project.
function renderProject(ctx: TaskContext, parts: string[]): void {
  if (!(ctx.projectId || (ctx.projectResources && ctx.projectResources.length > 0))) return;
  parts.push("## Project Context\n");
  if (ctx.projectTitle) {
    parts.push(`This issue belongs to **${ctx.projectTitle}**.\n`);
  }
  if (ctx.projectResources && ctx.projectResources.length > 0) {
    parts.push("Project resources:\n");
    for (const r of ctx.projectResources) {
      parts.push(`- ${formatProjectResource(r)}`);
    }
    parts.push("");
    parts.push(
      "Resources are pointers — open them only when relevant to the task. For repo resources, clone the URL into the working directory before you start editing.\n",
    );
  } else {
    parts.push("This project has no resources attached yet.\n");
  }
}

// Skills — list names; Claude Code auto-discovers SKILL.md files from
// .claude/skills/ in the workdir, so we don't have to inline the bodies.
/**
 * Team agents — every other non-archived agent in this workspace. Inlined
 * so the agent doesn't have to run `agora agent list` before deciding who
 * to delegate to or @mention. Members trust each other inside a workspace
 * by design (this is documented in CLAUDE.md), so we ship the snippet of
 * `instructions` as the "what is this agent for" signal — that's the field
 * that turns the roster from a name list into a routing decision aid.
 *
 * Budget: at most 10 KB total. Per-agent we cap instructions at the 500
 * chars the server already trimmed to, plus a couple hundred bytes of
 * surrounding markdown. With 60 agents in the worst case that's ~45 KB if
 * every agent had a full 500-char instruction; the total cap kicks in
 * first to keep CLAUDE.md reasonable.
 */
function renderTeamAgents(agents: TaskContext["teamAgents"], parts: string[]): void {
  if (!agents || agents.length === 0) return;
  const TOTAL_CAP = 12_000;
  parts.push("## Team Agents\n");
  parts.push(
    "Other agents in this workspace. Use `agora agent get <id>` for full details, or @mention by name from a comment to route work to them. `agora issue update <id> --assignee-id <agent-id>` reassigns. The Status / Skills / MCP lines are the routing-decision signals — prefer agents that are online, not saturated, and have skills or MCP servers matching the task.\n",
  );
  let used = 0;
  let shown = 0;
  for (const a of agents) {
    const header = `### ${a.name}  \`${a.id}\``;
    const meta = `_${a.cliKind}${a.model ? ` · ${a.model}` : ""}${a.ownerId ? ` · owner \`${a.ownerId}\`` : ""}_`;

    const statusBits: string[] = [];
    if (a.runtimeOnline === true) statusBits.push("online");
    else if (a.runtimeOnline === false) statusBits.push("**offline**");
    else statusBits.push("no runtime");
    statusBits.push(`load ${a.loadActive}/${a.loadCap}`);
    if (a.loadActive >= a.loadCap && a.loadCap > 0) statusBits.push("**saturated**");
    const statusLine = `Status: ${statusBits.join(" · ")}`;

    // Sort defensively here so the rendered output stays stable regardless
    // of the caller's order. (The server enricher already sorts, but
    // direct calls into buildClaudeMd from tests / future code paths
    // shouldn't have to remember to.)
    const skillsLine =
      a.skills.length > 0
        ? `Skills: ${[...a.skills].sort().join(", ")}`
        : "Skills: _(none — generic agent)_";
    const mcpLine =
      a.mcpServers.length > 0
        ? `MCP:    ${[...a.mcpServers].sort().join(", ")}`
        : "MCP:    _(none)_";

    const desc = a.description ? a.description : "_(no description)_";
    const inst = a.instructions ? `\n\n> ${a.instructions.replace(/\n/g, "\n> ")}` : "";
    const block = `${header}\n${meta}\n\n${statusLine}\n${skillsLine}\n${mcpLine}\n\n${desc}${inst}\n`;
    if (used + block.length > TOTAL_CAP) {
      const remaining = agents.length - shown;
      if (remaining > 0) {
        parts.push(`_…and ${remaining} more — list with \`agora agent list --output json\`._\n`);
      }
      break;
    }
    parts.push(block);
    used += block.length;
    shown += 1;
  }
}

function renderSkills(skills: TaskContext["agentSkills"], parts: string[]): void {
  if (!skills || skills.length === 0) return;
  parts.push("## Skills\n");
  parts.push("You have the following skills installed (auto-discovered from `.claude/skills/`):\n");
  for (const skill of skills) {
    parts.push(`- **${skill.name}**`);
  }
  parts.push("");
}

/**
 * Workspace knowledge — inline the actual content (unlike skills, which
 * Claude Code auto-discovers from disk). Two budgets:
 *   - per-doc cap: 4000 chars, truncated mid-doc with a note
 *   - total cap:   24000 chars, drop the rest entirely with a count
 * Tuned so a workspace with a few hundred small docs (FAQs, decisions)
 * fits, while a single multi-thousand-line runbook doesn't blow up the
 * agent's context window.
 *
 * Kind label is included so the agent can prioritize (e.g. trust a
 * `decision` over a `general` note when they conflict).
 */
function renderKnowledge(docs: TaskContext["knowledgeDocs"], parts: string[]): void {
  if (!docs || docs.length === 0) return;
  const PER_DOC_CAP = 4000;
  const TOTAL_CAP = 24000;
  parts.push("## Workspace Knowledge\n");
  parts.push(
    "These are docs the team has captured in Agora's Knowledge Base. " +
      "Treat them as authoritative for workspace-specific facts (FAQs, " +
      "decisions, runbooks, onboarding) unless the user contradicts them.\n",
  );
  let used = 0;
  let dropped = 0;
  for (const d of docs) {
    if (used >= TOTAL_CAP) {
      dropped++;
      continue;
    }
    const remaining = TOTAL_CAP - used;
    const cap = Math.min(PER_DOC_CAP, remaining);
    const truncated = d.content.length > cap;
    const body = truncated ? `${d.content.slice(0, cap)}\n\n_(truncated)_` : d.content;
    parts.push(`### [${d.kind}] ${d.title}\n`);
    parts.push(`${body}\n`);
    used += body.length;
  }
  if (dropped > 0) {
    parts.push(
      `\n_…and ${dropped} more doc${dropped === 1 ? "" : "s"} omitted to keep this prompt under ~${TOTAL_CAP} chars; query Agora directly if you need them._\n`,
    );
  }
}

/**
 * Sediment-and-share section. Tells the agent WHEN it should distill
 * what it just learned into a reusable artifact for the rest of the
 * workspace, and HOW (which CLI command + which kind to pick).
 *
 * The default Claude posture is "do the task, exit"; without an
 * explicit prompt it never thinks "huh, this would help next time".
 * This section is the nudge.
 */
function renderSharingPolicy(parts: string[]): void {
  parts.push("## Sharing what you learn\n");
  parts.push(
    "After you finish a task, take 30 seconds to ask: did I discover something a future agent (or human teammate) would want to know? If yes, **sediment it** — Agora has two stores for this:\n",
  );
  parts.push(
    "- **`agora knowledge create`** — for facts, decisions, FAQs, runbooks, onboarding notes. The doc inlines into every future agent's CLAUDE.md automatically. Pick the kind:",
  );
  parts.push("    - `decision` — irreversible team decisions ('we use Render not Fly')");
  parts.push("    - `faq`      — common questions + their answers");
  parts.push("    - `runbook`  — operational steps ('how to roll back a deploy')");
  parts.push("    - `onboarding` — setup notes new contributors need");
  parts.push("    - `general`  — anything else worth remembering");
  parts.push("");
  parts.push(
    "- **`agora skill create`** — for reusable procedures or tool wrappers (multi-step workflows, complex CLI invocations, integration recipes). Skills are auto-discovered from `.claude/skills/` so other agents can invoke them by name.",
  );
  parts.push("");
  parts.push("Use stdin for multi-line content so newlines and code blocks survive intact:");
  parts.push("");
  parts.push("```");
  parts.push(
    "agora knowledge create --kind decision --title 'Use Drizzle migrations not raw SQL' --content-stdin <<'DOC'",
  );
  parts.push("Decided 2026-05-13. Drizzle's snapshot keeps schema + migrations in sync.");
  parts.push("Raw SQL has bitten us twice with column drift. Always run `bun db:generate`.");
  parts.push("DOC");
  parts.push("```");
  parts.push("");
  parts.push(
    "**Heuristics for when to sediment:** you spent >5 min figuring something out; a workflow has 3+ steps you'll repeat; you found a non-obvious fix or workaround; the team hasn't agreed on something and you just made a call. Don't sediment trivia — only what's load-bearing for future work.\n",
  );
  parts.push(
    "Don't ask the user permission first — sedimenting is part of finishing the task. If the user objects later, the doc is a normal `agora knowledge` row that anyone can edit or delete.\n",
  );
}

function renderSedimentation(parts: string[]): void {
  parts.push("## Sediment what you learned\n");
  parts.push(
    "Before finishing, ask yourself one question: **would a future agent — me or someone else — be better off because of what I just figured out?** If yes, write a `SKILL.md` at the **root of your working directory**. Agora's daemon picks it up at task end and uploads it as a workspace-visible skill so every future run sees it automatically.\n",
  );
  parts.push("There are two situations where the answer is almost always yes:\n");
  parts.push(
    "1. **You completed something reusable.** A multi-step workflow, a complex integration, a non-obvious procedure that other agents will plausibly hit again. The skill captures the happy path — the working recipe — so the next agent doesn't re-derive it.",
  );
  parts.push(
    "2. **You hit a pit and climbed out.** Something failed repeatedly, you tried wrong approaches, you found a workaround or root cause that wasn't obvious from the code. The skill captures the **trap and the escape** — what looks reasonable but doesn't work, and what actually does. Future agents reading this avoid the same hours of pain.",
  );
  parts.push("");
  parts.push(
    "Format: standard Skill markdown — a `---` YAML frontmatter block with `name:` and `description:` fields, then the body. Lead the body with **when to use this** (one sentence), then the procedure or the gotcha. For trap-and-escape skills, name the trap explicitly: 'If you try X, you'll see Y — that's a dead end. Do Z instead because W.'\n",
  );
  parts.push(
    "Skip the file entirely when nothing this task surfaced is load-bearing for future work. Forced or padded skills add noise to every future run; an honest empty pass is better than a fabricated one.\n",
  );
}

function renderChatWorkflow(parts: string[]): void {
  parts.push("**You are in chat mode.** A user is messaging you directly in a chat window.\n");
  parts.push("- Respond conversationally and helpfully to the user's message.");
  parts.push(
    "- You have full access to the `agora` CLI to look up issues, workspace info, members, agents, etc.",
  );
  parts.push(
    "- If asked about issues, use `agora issue list --output json` or `agora issue get <id> --output json`.",
  );
  parts.push("- If asked about the workspace, use `agora workspace get --output json`.");
  parts.push(
    "- If asked to perform actions (create issues, update status, etc.), use the appropriate CLI commands.",
  );
  parts.push("- Keep responses concise and direct.\n");
}

function renderQuickCreateWorkflow(parts: string[]): void {
  parts.push(
    "**This task was triggered by quick-create.** There is NO existing Agora issue. Follow the field and output rules in the user message you just received; ignore the default assignment-task workflow.\n",
  );
  parts.push("Hard guardrails (apply even if the user message is missing):");
  parts.push("- Run exactly one `agora issue create` invocation, then exit.");
  parts.push(
    "- Do NOT call `agora issue get`, `agora issue status`, or `agora issue comment add` for this task — there is no issue to query, transition, or comment on.",
  );
  parts.push(
    "- If the CLI returns an error, exit with that error as the only output. Do not retry.\n",
  );
}

function renderAutopilotWorkflow(ctx: TaskContext, parts: string[]): void {
  parts.push(
    "**This task was triggered by an Autopilot in run-only mode.** There is no assigned Agora issue for this run.\n",
  );
  parts.push(`- Autopilot run ID: \`${ctx.autopilotRunId}\``);
  if (ctx.autopilotId) parts.push(`- Autopilot ID: \`${ctx.autopilotId}\``);
  if (ctx.autopilotTitle) parts.push(`- Autopilot title: ${ctx.autopilotTitle}`);
  if (ctx.autopilotSource) parts.push(`- Trigger source: ${ctx.autopilotSource}`);
  if (ctx.autopilotTriggerPayload) {
    parts.push("- Trigger payload:");
    parts.push("");
    parts.push("```json");
    parts.push(ctx.autopilotTriggerPayload);
    parts.push("```");
  }
  if (ctx.autopilotDescription && ctx.autopilotDescription.trim().length > 0) {
    parts.push("");
    parts.push("Autopilot instructions:");
    parts.push("");
    parts.push(ctx.autopilotDescription);
  }
  parts.push("");
  parts.push("- Complete the autopilot instructions directly.");
  parts.push(
    "- Do NOT run `agora issue get`, `agora issue comment add`, or `agora issue status` for this run unless the autopilot instructions explicitly tell you to create or update an issue.\n",
  );
}

function renderCommentWorkflow(ctx: TaskContext, parts: string[]): void {
  parts.push(
    "**This task was triggered by a NEW comment.** Your primary job is to respond to THIS specific comment, even if you have handled similar requests in this session.\n",
  );
  if (ctx.issueId) {
    parts.push(
      `1. Run \`agora issue get ${ctx.issueId} --output json\` to understand the issue context.`,
    );
    parts.push(
      `2. Run \`agora issue comment list ${ctx.issueId} --output json\` to read the conversation.`,
    );
    parts.push(
      "   - If the output is large or truncated, paginate: `--limit 30` for the latest 30, or `--since <iso>` to fetch only recent.",
    );
    parts.push(
      `3. Find the triggering comment (ID: \`${ctx.triggerCommentId}\`) and understand what is being asked — do NOT confuse it with previous comments.`,
    );
  } else {
    parts.push(
      `1. Find the triggering comment (ID: \`${ctx.triggerCommentId}\`) and understand what is being asked.`,
    );
  }
  parts.push(
    "4. **Decide whether a reply is warranted.** If you produced actual work this turn (investigated, fixed, answered a real question), post the result via the next step — that is a normal reply, not a noise comment. If the triggering comment was a pure acknowledgment / thanks / sign-off from another agent AND you produced no work this turn, do NOT post a reply — and do NOT post a comment saying 'No reply needed' or similar. Simply exit with no output. Silence is a valid and preferred way to end agent-to-agent conversations.",
  );
  parts.push(
    "5. If a reply IS warranted: do any requested work first, then **decide whether to include any `@mention` link.** The default is NO mention. Only mention when escalating to a human owner who is not yet involved, delegating a concrete new sub-task to another agent for the first time, or the user explicitly asked you to loop someone in. Never @mention the agent you are replying to as a thank-you or sign-off.",
  );
  parts.push(
    "6. **If you reply, post it as a comment — this step is mandatory when you reply.** Text in your terminal or run logs is NOT delivered to the user. Use `agora issue comment add <issue-id> --parent <triggering-comment-id> --content-stdin` with a HEREDOC.",
  );
  parts.push(
    "7. Manage the issue status as appropriate; if you change it, use `agora issue status`. Do NOT change status unless the comment asks for it.\n",
  );
}

function renderIssueWorkflow(ctx: TaskContext, parts: string[]): void {
  if (ctx.issueId) {
    parts.push(
      "You were assigned to an issue. Read the issue, do the work, and report results as a comment.\n",
    );
    parts.push(
      `1. Run \`agora issue get ${ctx.issueId} --output json\` to understand your task. **Pay attention to the \`blockedBy\` array** — see the \"Dependency check\" callout below.`,
    );
    parts.push(
      `2. Run \`agora issue comment list ${ctx.issueId} --output json\` to read the full comment history — this is mandatory, not optional. Earlier comments often carry context the issue body lacks (e.g. which repo to work in, the prior agent's findings, the reason the issue was reassigned to you). Skipping this step is the most common cause of agents acting on stale or incomplete instructions.`,
    );
    parts.push(
      "   - If the output is large or truncated, paginate: `--limit 30` for the latest 30, or `--since <iso>` to fetch only recent.",
    );
    parts.push("3. Follow your Skills and Agent Identity to complete the task.");
    parts.push(
      `4. **Post your final results as a comment — this step is mandatory**: \`agora issue comment add ${ctx.issueId} --content-stdin\` with a HEREDOC. Your results are only visible to the user if posted via this CLI call; text in your terminal or run logs is NOT delivered.`,
    );
    parts.push(
      "5. Manage the issue status as appropriate; if you change it, use `agora issue status`. (Agora does not prescribe a fixed in_progress → done flow — change status when it actually reflects the state of the work.)\n",
    );
    parts.push("### Dependency check (do this FIRST)\n");
    parts.push(
      `When \`agora issue get ${ctx.issueId} --output json\` returns a non-empty \`blockedBy\`, your first action depends on the blockers' statuses:`,
    );
    parts.push(
      "- **Every blocker is `done` or `cancelled`** → proceed normally with steps 2–5 above.",
    );
    parts.push("- **At least one blocker is still in flight** → do NOT start the work. Instead:");
    parts.push(
      `    1. \`agora issue comment add ${ctx.issueId} --content-stdin\` with a HEREDOC stating which blockers you're waiting for (cite their identifiers).`,
    );
    parts.push(
      `    2. \`agora issue status ${ctx.issueId} blocked\` to flip the issue to blocked.`,
    );
    parts.push(
      "    3. Exit. The platform watches the blocker — when it resolves, the server flips this issue back to `todo` and re-enqueues a fresh task for you. You don't need to poll.",
    );
    parts.push(
      "Do not silently skip work or invent a partial result when blocked — the comment + status flip is the contract that makes the unblock sweep wake you up later.\n",
    );
    return;
  }
  // No issue, no chat, no quick-create — generic fallback.
  parts.push("Use the `agora` CLI to complete the task you were just asked about.\n");
}

// Workflow branches by trigger type. The per-turn prompt is now thin, so
// this section carries the canonical instructions.
function renderWorkflow(ctx: TaskContext, parts: string[]): void {
  if (ctx.chatSessionId) return renderChatWorkflow(parts);
  if (ctx.quickCreatePrompt) return renderQuickCreateWorkflow(parts);
  if (ctx.autopilotRunId) return renderAutopilotWorkflow(ctx, parts);
  if (ctx.triggerCommentId) return renderCommentWorkflow(ctx, parts);
  return renderIssueWorkflow(ctx, parts);
}

// Mentions section.
function renderMentions(parts: string[]): void {
  parts.push("## Mentions\n");
  parts.push("Mention links are **side-effecting actions**, not just formatting:\n");
  parts.push(
    "- `[I-123](mention://issue/<issue-id>)` — clickable link to an issue (safe, no side effect)",
  );
  parts.push("- `[@Name](mention://member/<user-id>)` — **sends a notification to a human**");
  parts.push("- `[@Name](mention://agent/<agent-id>)` — **enqueues a new run for that agent**\n");
  parts.push("### When NOT to use a mention link\n");
  parts.push(
    '- Referring to someone in prose (e.g. "GPT-Boy is right") — write the plain name, no link.',
  );
  parts.push(
    "- **Replying to another agent that just spoke to you.** By default, do NOT put a `mention://agent/...` link anywhere in your reply. The platform already shows your comment to everyone on the issue; re-mentioning the other agent will make them run again, and if they reply with a mention back, you will be triggered again. That is a loop and it costs the user money.",
  );
  parts.push(
    '- Thanking, acknowledging, wrapping up, or signing off. These are exactly the moments where an accidental `@mention` causes the other agent to reply "you\'re welcome" and restart the loop. If the work is done, **end with no mention at all**.\n',
  );
  parts.push("### When a mention IS appropriate\n");
  parts.push("- Escalating to a human owner who is not yet involved.");
  parts.push(
    "- Delegating a concrete sub-task to another agent for the first time, with a clear request.",
  );
  parts.push("- The user explicitly asked you to loop someone in.\n");
  parts.push(
    "If you are unsure whether a mention is warranted, **don't mention**. Silence ends conversations; `@` restarts them.\n",
  );
  parts.push(
    "Use `agora issue list --output json` to look up issue IDs, and `agora workspace members --output json` for member IDs.\n",
  );
}

function renderAttachments(parts: string[]): void {
  parts.push("## Attachments\n");
  parts.push("Issues and comments may include file attachments (images, documents, etc.).");
  parts.push("Use the download command to fetch attachment files locally:\n");
  parts.push("```");
  parts.push("agora attachment download <attachment-id>");
  parts.push("```\n");
  parts.push(
    "This downloads the file to the current directory and prints the local path. Use `-o <dir>` to save elsewhere.",
  );
  parts.push(
    "After downloading, you can read the file directly (e.g. view an image, read a document).\n",
  );
}

function renderAlwaysUseCli(parts: string[]): void {
  parts.push("## Important: Always Use the `agora` CLI\n");
  parts.push(
    "All interactions with Agora platform resources — issues, comments, attachments, images, files, and any other platform data — **must** go through the `agora` CLI. Do NOT use `curl`, `wget`, or any other HTTP client to access Agora URLs or APIs directly. Agora resource URLs require authenticated access that only the `agora` CLI can provide.\n",
  );
  parts.push(
    "If you need an operation that is not covered by any existing `agora` command, do NOT attempt to work around it. Instead, post a comment mentioning the workspace owner to request the missing functionality.\n",
  );
}

// Output rules — branch by trigger type, with the i18n line appended on
// comment / assignment branches per spec.
function renderOutput(ctx: TaskContext, parts: string[]): void {
  parts.push("## Output\n");
  if (ctx.autopilotRunId) {
    parts.push(
      "This is a run-only autopilot task, so there may be no issue comment to post. Your final assistant output is captured automatically as the autopilot run result. Keep it concise and state the outcome.",
    );
    return;
  }
  if (ctx.quickCreatePrompt) {
    parts.push(
      "This is a quick-create task. There is NO existing issue to comment on. Your final stdout is captured automatically and the platform writes the user's success/failure inbox notification based on whether `agora issue create` succeeded.\n",
    );
    parts.push(
      "- Do NOT call `agora issue comment add` — the issue you just created has no conversation context for this run.",
    );
    parts.push(
      "- Print exactly one final line: `Created <identifier>: <title>` after a successful `agora issue create`.",
    );
    parts.push(
      "- On CLI failure, exit with the CLI error as the only output. The platform translates that into a `quick_create_failed` inbox item carrying the original prompt for the user.",
    );
    return;
  }
  if (ctx.chatSessionId) {
    parts.push(
      "Your final assistant message is captured as the chat reply. Keep it concise and direct — markdown is fine, code blocks render natively.",
    );
    return;
  }
  if (ctx.triggerCommentId) {
    parts.push(
      "**Final results MUST be delivered via `agora issue comment add`.** The user does NOT see your terminal output, assistant chat text, or run logs — only comments on the issue. A task that finishes without a result comment is invisible to the user, even if the work itself was correct.\n",
    );
    parts.push("Keep comments concise and natural — state the outcome, not the process.");
    parts.push('Good: "Fixed the login redirect. PR: https://..."');
    parts.push('Bad: "1. Read the issue 2. Found the bug in auth.go 3. Created branch 4. ..."');
    parts.push(
      "When referencing an issue in a comment, use the issue mention format `[I-123](mention://issue/<issue-id>)` so it renders as a clickable link. (Issue mentions have no side effect; only member/agent mentions do — see the Mentions section above.)",
    );
    parts.push(
      "When replying to a comment, use the language of the triggering comment (Chinese if the comment is Chinese, English otherwise).",
    );
    return;
  }
  parts.push(
    "**Final results MUST be delivered via `agora issue comment add`.** The user does NOT see your terminal output, assistant chat text, or run logs — only comments on the issue. A task that finishes without a result comment is invisible to the user, even if the work itself was correct.\n",
  );
  parts.push("Keep comments concise and natural — state the outcome, not the process.");
  parts.push('Good: "Fixed the login redirect. PR: https://..."');
  parts.push('Bad: "1. Read the issue 2. Found the bug in auth.go 3. Created branch 4. ..."');
  parts.push(
    "When referencing an issue in a comment, use the issue mention format `[I-123](mention://issue/<issue-id>)` so it renders as a clickable link.",
  );
  parts.push(
    "When replying to a comment, use the language of the triggering comment (Chinese if the comment is Chinese, English otherwise).",
  );
}

// buildClaudeMd renders the durable runtime config that gets written into the
// agent's working directory as CLAUDE.md before the CLI starts. This is the
// "high-leverage" half of the two-layer prompt architecture — workflow + CLI
// surface live here, and the per-turn prompt becomes a thin trigger-specific
// nudge.
//
// Sections are emitted conditionally so absent context
// (no project, no repos, no skills) just elides the corresponding block.
export function buildClaudeMd(ctx: TaskContext): string {
  const parts: string[] = [];

  parts.push("# Agora Agent Runtime\n");
  parts.push(
    "You are a coding agent in the Agora platform. Use the `agora` CLI to interact with the platform.\n",
  );

  renderAgentIdentity(ctx, parts);
  renderAvailableCommands(parts);
  renderRepos(ctx.repos, parts);
  renderProject(ctx, parts);
  renderTeamAgents(ctx.teamAgents, parts);
  renderSkills(ctx.agentSkills, parts);
  renderKnowledge(ctx.knowledgeDocs, parts);
  renderSharingPolicy(parts);

  renderSedimentation(parts);

  parts.push("## Workflow\n");
  renderWorkflow(ctx, parts);

  renderMentions(parts);
  renderAttachments(parts);
  renderAlwaysUseCli(parts);
  renderOutput(ctx, parts);

  return `${parts.join("\n")}\n`;
}

// injectRuntimeConfig writes the rendered CLAUDE.md into the agent's working
// directory. claude_code is the only provider Agora ships today, so we only
// emit CLAUDE.md (a multi-provider switch is deferred until we add
// codex / gemini / etc. runners).
export async function injectRuntimeConfig(workDir: string, ctx: TaskContext): Promise<void> {
  const content = buildClaudeMd(ctx);
  await writeFile(join(workDir, "CLAUDE.md"), content, { mode: 0o644 });
}

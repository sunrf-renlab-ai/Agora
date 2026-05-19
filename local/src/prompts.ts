import { type IssueCtx, type PromptKind, type PromptTemplates, renderPrompt } from "@agora/shared";

export interface ClaimResponse {
  task: {
    id: string;
    workspaceId: string;
    agentId: string;
    issueId: string | null;
    chatSessionId: string | null;
    triggerCommentId: string | null;
    triggerSummary: string | null;
    quickCreatePrompt: string | null;
    chatPrompt: string | null;
    originType: "autopilot" | "quick_create" | null;
    priorSession: { session_id: string | null; work_dir: string | null } | null;
    triggerComment: {
      id: string;
      content: string;
      authorKind: "member" | "agent";
      authorName: string;
      createdAt: string;
    } | null;
    /** Server-supplied attempt counter starting at 1. >1 implies retry/continuation. */
    attempt: number;
    /** Set when this task was spawned as a retry/rerun of a prior task. */
    parentTaskId: string | null;
    autopilotRunId: string | null;
    autopilotId: string | null;
    autopilotTitle: string | null;
    autopilotDescription: string | null;
    autopilotSource: string | null;
    autopilotTriggerPayload: string | null;
  };
  agent: {
    id: string;
    name: string;
    cliKind: string;
    model: string | null;
    customEnv: Record<string, string>;
    customArgs: string[];
    mcpConfig: Record<string, unknown>;
    instructions: string;
    /** Optional Liquid templates per trigger kind. Empty `{}` means use the legacy builders below. */
    promptTemplates: PromptTemplates;
  };
  issue: { id: string; identifier?: string; title?: string; description?: string | null } | null;
  repos: Array<{ url: string }>;
  projectId: string | null;
  projectTitle: string | null;
  projectResources: Array<{ resourceType: string; resourceRef: unknown; label?: string | null }>;
  agentSkills: Array<{ name: string }>;
  /** Workspace KB docs the daemon inlines into CLAUDE.md. Optional so
   *  older servers that haven't deployed yet still claim cleanly. */
  knowledgeDocs?: Array<{ kind: string; title: string; content: string }>;
  /** Other agents in the workspace, surfaced into CLAUDE.md so the agent
   *  can route work / @mention without a separate `agora agent list` call.
   *  Optional for back-compat with pre-roster servers. */
  teamAgents?: Array<{
    id: string;
    name: string;
    description: string;
    instructions: string;
    cliKind: string;
    model: string | null;
    ownerId: string | null;
    skills: string[];
    mcpServers: string[];
    runtimeOnline: boolean | null;
    loadActive: number;
    loadCap: number;
  }>;
  taskToken: string;
  /** The agent owner's GitHub token, when they connected GitHub. Injected
   *  into the CLI env as GH_TOKEN/GITHUB_TOKEN. Optional / null otherwise. */
  githubToken?: string | null;
}

function pickKind(task: ClaimResponse["task"], issue: ClaimResponse["issue"]): PromptKind | null {
  if (task.chatPrompt) return "chat";
  if (task.quickCreatePrompt) return "quick_create";
  if (task.originType === "autopilot" && !task.issueId) return "autopilot";
  if (issue && task.triggerComment) return "comment";
  if (issue) return "issue";
  return null;
}

function toIssueCtx(issue: NonNullable<ClaimResponse["issue"]>): IssueCtx {
  return {
    id: issue.id,
    identifier: issue.identifier ?? null,
    title: issue.title ?? "",
    description: issue.description ?? null,
    // The claim payload doesn't yet surface status/priority/labels/url/branch
    // — pass safe defaults so user templates can still reference them under
    // strict mode (LiquidJS throws on unknown keys, not on null values).
    status: "",
    priority: null,
    labels: [],
    url: null,
    branchName: null,
  };
}

export function buildPrompt(
  task: ClaimResponse["task"],
  agent: ClaimResponse["agent"],
  issue: ClaimResponse["issue"],
): string {
  // When the agent has a Liquid template for this trigger
  // kind, render it strictly. Otherwise fall through to the legacy hardcoded
  // builders. Render failures bubble up to the daemon; that path tags the run
  // with error_kind=prompt_render_error.
  const kind = pickKind(task, issue);
  const tpl = kind ? agent.promptTemplates?.[kind] : undefined;
  if (kind && tpl && tpl.trim().length > 0) {
    const attempt = task.attempt > 1 ? task.attempt : null;
    const continuation = task.priorSession?.session_id != null && task.attempt > 1;
    return renderPrompt(tpl, {
      agent: {
        id: agent.id,
        name: agent.name,
        instructions: agent.instructions,
        model: agent.model,
        cliKind: agent.cliKind,
      },
      task: {
        id: task.id,
        attempt: task.attempt,
        originType: task.originType,
        parentTaskId: task.parentTaskId,
      },
      issue: issue ? toIssueCtx(issue) : undefined,
      attempt,
      continuation,
      triggerComment: task.triggerComment
        ? {
            id: task.triggerComment.id,
            content: task.triggerComment.content,
            authorKind: task.triggerComment.authorKind,
            authorName: task.triggerComment.authorName,
          }
        : undefined,
      triggerSummary: task.triggerSummary ?? undefined,
    });
  }

  if (task.chatPrompt) return buildChatPrompt(task, agent);
  if (task.quickCreatePrompt) return buildQuickCreatePrompt(task, agent);
  if (task.originType === "autopilot" && !task.issueId) return buildAutopilotPrompt(task);
  if (issue && task.triggerComment) return buildCommentPrompt(task, agent, issue);
  if (issue) return buildIssuePrompt(task, agent, issue);
  return agent.instructions;
}

// Quick-create assistant — the agent's job is to translate ONE natural-
// language input into ONE `agora issue create` call. No code investigation,
// no file browsing — there's no codebase context here, and rummaging the
// user's filesystem trips macOS TCC permission prompts. Stay in the lane.
function buildQuickCreatePrompt(
  task: ClaimResponse["task"],
  agent: ClaimResponse["agent"],
): string {
  const userInput = task.quickCreatePrompt ?? "";
  const lines = [
    "You are running as a quick-create assistant for an Agora workspace.",
    "",
    "A user captured the following input via the quick-create modal. There is NO existing issue. Your job is to create a well-formed issue from this input with a single `agora issue create` command.",
    "",
    "Do NOT browse the local filesystem, do NOT read user files, do NOT investigate any codebase. There is no project context here — your only inputs are this prompt and any URLs in the user input. Filesystem access in this run will trigger OS permission prompts and is unnecessary.",
    "",
    "User input:",
    `> ${userInput}`,
    "",
    "Field rules:",
    "",
    '- **--title**: required. A concise but semantically rich summary. Strip filler words but preserve key semantic information. If the input references external resources (PRs, issues, URLs) and you can fetch them safely, use that to refine the title (e.g. "review PR #123" → "Review PR #123: Refactor auth module").',
    "",
    "- **--description**: optional, but include it whenever the user wrote more than a one-line title. The description is the primary context for whoever (or whichever agent) eventually picks this issue up. Goal: high fidelity. If the user wrote three sentences, the description carries at least that much information.",
    "  Structure:",
    "  1. **User request** — restate what the user wants in their own terms. Preserve their phrasing, tone, scope. Do NOT paraphrase into generic language. Do NOT add implementation plans, acceptance criteria, or constraints the user did not express.",
    "  2. **Context** (only if input has URLs / references) — fetch and summarize verifiable facts. Skip this section entirely if there are no external references.",
    "  Hard rules:",
    "  - NEVER invent requirements, implementation details, acceptance criteria, or scope the user didn't express.",
    "  - NEVER reduce multi-sentence input to one vague sentence.",
    "  - Preserve specific names, identifiers, file paths, code snippets verbatim.",
    "  - Never echo the title in the description.",
    "",
    '- **--priority**: one of `urgent`, `high`, `medium`, `low`, or omit. Map P0/P1 → urgent/high; "asap" → urgent. If unspecified, omit.',
    "",
    `- **--assignee-kind / --assignee-id**: when the user didn't name anyone, default to YOURSELF: pass \`--assignee-kind agent --assignee-id ${agent.id}\`. Never leave the issue unassigned.`,
    "",
    "- **status / project**: omit. Defaults are correct.",
    "",
    "Output:",
    "- Run exactly ONE `agora issue create` invocation. Do not retry on non-zero exit; the issue may already exist and a retry would duplicate it.",
    "- After success, print exactly one line: `Created <identifier>: <title>` and exit. No commentary, no follow-up tool calls.",
    "- Do NOT call `agora issue get` or `agora issue comment add` — there is no issue yet.",
    "- On CLI error, exit with the error as the only output. The platform writes a failure notification automatically.",
  ];
  return lines.join("\n");
}

// Chat assistant — short and to the point. The chat session UI is the place
// for back-and-forth; the agent shouldn't initiate workspace tool calls
// unless explicitly asked.
//
// IMPORTANT: `task.chatPrompt` is ALREADY the full prompt the server
// built (server/src/services/chat.ts::buildChatPrompt) — agent
// instructions + the entire `User: …` / `Agent: …` transcript. We MUST
// NOT wrap it with another envelope and slap "User message:" on top;
// that double-wrapping leaks Claude's expected role-prefix pattern
// into the rendered transcript and the agent ends up echoing things
// like "User: thanks\n\nReply to the user." into its reply. Hand the
// server-built prompt through verbatim.
function buildChatPrompt(task: ClaimResponse["task"], _agent: ClaimResponse["agent"]): string {
  return task.chatPrompt ?? "";
}

// Issue-attached coding agent (assignment-triggered path). The agent's
// identity and the full workflow live in CLAUDE.md (written by the runner
// before spawn); the per-turn prompt is now a thin trigger-specific nudge.
//
// Builds the per-task agent prompt's assignment branch — short, deferential
// to CLAUDE.md.
function buildIssuePrompt(
  task: ClaimResponse["task"],
  _agent: ClaimResponse["agent"],
  issue: NonNullable<ClaimResponse["issue"]>,
): string {
  const lines: string[] = [
    "You are running as a local coding agent for an Agora workspace.",
    "",
    `Your assigned issue ID is: ${issue.id}`,
    "",
    `Start by running \`agora issue get ${issue.id} --output json\` to understand your task, then complete it.`,
    "",
    `If you genuinely cannot complete this — it needs human credentials or secrets, a human decision or judgment call you cannot make, or an offline/manual action — run \`agora issue escalate ${issue.id} --reason "<why no agent can do this>"\` to hand it to a human. Do this instead of guessing or reporting false success.`,
  ];
  if (task.triggerSummary) lines.push("", `(trigger: ${task.triggerSummary})`);
  return lines.join("\n");
}

// Comment-triggered coding agent. The triggering comment content is embedded
// directly in the prompt so the agent cannot miss it, even when stale output
// files exist in a reused workdir. The reply instructions (including the
// current triggerCommentId as --parent) are re-emitted on every turn so
// resumed sessions cannot carry forward a previous turn's --parent UUID.
//
// Workflow + CLI surface live in CLAUDE.md (injectRuntimeConfig); this
// per-turn prompt only carries the trigger-specific facts (which comment,
// what it said, who said it).
function buildCommentPrompt(
  task: ClaimResponse["task"],
  _agent: ClaimResponse["agent"],
  issue: NonNullable<ClaimResponse["issue"]>,
): string {
  // Dispatcher guarantees triggerComment is non-null on this branch.
  const tc = task.triggerComment as NonNullable<ClaimResponse["task"]["triggerComment"]>;
  const authorLabel =
    tc.authorKind === "agent"
      ? `Another agent (${tc.authorName || "unknown agent"})`
      : `A user (${tc.authorName || "unknown user"})`;

  const lines: string[] = [
    "You are running as a local coding agent for an Agora workspace.",
    `Your assigned issue ID is: ${issue.id}`,
    "",
    `[NEW COMMENT] ${authorLabel} just left a new comment. Focus on THIS comment — do not confuse it with previous ones:`,
    "",
    `> ${tc.content.replace(/\n/g, "\n> ")}`,
    "",
  ];

  if (tc.authorKind === "agent") {
    lines.push(
      "Note: the triggering comment was posted by another agent. Decide whether a reply is warranted. If you produced actual work this turn (investigated, fixed something, answered a real question), post the result as a normal reply. If the triggering comment was a pure acknowledgment, thanks, or sign-off AND you produced no work this turn, do NOT reply — and do NOT post a 'No reply needed' comment. Silence is the preferred way to end agent-to-agent threads.",
      "",
    );
  }

  lines.push(
    `Start by running \`agora issue get ${issue.id} --output json\` to understand your task, then decide how to proceed.`,
    "",
    `If you genuinely cannot do what's being asked — it needs human credentials or secrets, a human decision or judgment call you cannot make, or an offline/manual action — run \`agora issue escalate ${issue.id} --reason "<why no agent can do this>"\` to hand it to a human instead of guessing or reporting false success.`,
    "",
    buildCommentReplyInstructions(issue.id, tc.id),
  );

  if (task.triggerSummary) lines.push("", `(trigger: ${task.triggerSummary})`);
  return lines.join("\n");
}

// buildCommentReplyInstructions returns the canonical block telling an agent
// how to post its reply for a comment-triggered task. Re-emitting this every
// turn (rather than relying on session memory) is intentional: resumed Claude
// sessions keep prior tool calls in context and will otherwise copy the old
// --parent UUID forward.
function buildCommentReplyInstructions(issueId: string, triggerCommentId: string): string {
  if (!triggerCommentId) return "";
  return [
    "If you decide to reply, post it as a comment — always use the trigger comment ID below, do NOT reuse --parent values from previous turns in this session.",
    "",
    "Always use `--content-stdin` with a HEREDOC for agent-authored issue comments, even when the reply is a single line. Do NOT use inline `--content`; it is easy to lose formatting or accidentally compress a structured reply into one line.",
    "",
    "Use this form, preserving the same issue ID and --parent value:",
    "",
    `    cat <<'COMMENT' | agora issue comment add ${issueId} --parent ${triggerCommentId} --content-stdin`,
    "    First paragraph.",
    "",
    "    Second paragraph.",
    "    COMMENT",
    "",
    "Do NOT write literal `\\n` escapes to simulate line breaks; the HEREDOC preserves real newlines.",
  ].join("\n");
}

// buildAutopilotPrompt constructs the per-turn prompt for a run-only autopilot
// task. There is no issue, so the agent must not call `agora issue get`. The
// canonical workflow + CLI surface live in CLAUDE.md; this prompt carries the
// run-specific facts (run id, autopilot id, instructions, trigger payload).
function buildAutopilotPrompt(task: ClaimResponse["task"]): string {
  const lines: string[] = [
    "You are running as a local coding agent for an Agora workspace.",
    "",
    "This task was triggered by an Autopilot in run-only mode. There is no assigned Agora issue.",
    "",
  ];
  if (task.autopilotRunId) lines.push(`Autopilot run ID: ${task.autopilotRunId}`);
  if (task.autopilotId) lines.push(`Autopilot ID: ${task.autopilotId}`);
  if (task.autopilotTitle) lines.push(`Autopilot title: ${task.autopilotTitle}`);
  if (task.autopilotSource) lines.push(`Trigger source: ${task.autopilotSource}`);
  if (task.autopilotTriggerPayload && task.autopilotTriggerPayload.trim().length > 0) {
    lines.push("Trigger payload:");
    lines.push(task.autopilotTriggerPayload.trim());
  }
  lines.push("");
  lines.push("Autopilot instructions:");
  if (task.autopilotDescription && task.autopilotDescription.trim().length > 0) {
    lines.push(task.autopilotDescription);
  } else if (task.autopilotTitle) {
    lines.push(task.autopilotTitle);
  } else {
    lines.push(
      "No additional autopilot instructions were provided. Refer to the run details above.",
    );
  }
  lines.push("");
  // Agora doesn't ship `agora autopilot get` yet — fall back to the run
  // details rendered above.
  lines.push("Refer to the run details above and complete the instructions.");
  lines.push("Do not run `agora issue get`; this run does not have an issue ID.");
  return lines.join("\n");
}

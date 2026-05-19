import { Liquid, type Template } from "liquidjs";

/**
 * Strict Liquid renderer for Agora prompt templates.
 *
 * Unknown variables and unknown filters MUST
 * fail rendering — silent fallback to empty string is the worst possible
 * behavior because the agent will run with a malformed prompt and only the
 * downstream output reveals the bug.
 *
 * Failures throw `PromptRenderError` so callers can map them to
 * `error_kind=prompt_render_error` on `agent_task_queue`.
 */

export class PromptRenderError extends Error {
  readonly cause?: unknown;
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message);
    this.name = "PromptRenderError";
    this.cause = opts?.cause;
  }
}

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
  // Disable filesystem access — templates are user-supplied strings, not files.
  // Without this LiquidJS would happily resolve `{% include %}` against the cwd.
  root: [],
  extname: "",
});

/**
 * Issue context passed to issue/comment templates. A normalized issue shape
 * using Agora's field names.
 */
export interface IssueCtx {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  labels: string[];
  url: string | null;
  branchName: string | null;
}

export interface AgentCtx {
  id: string;
  name: string;
  instructions: string;
  model: string | null;
  cliKind: string;
}

export interface WorkspaceCtx {
  id: string;
  slug: string;
  name: string;
}

export interface TaskCtx {
  id: string;
  attempt: number;
  originType: string | null;
  parentTaskId: string | null;
}

export interface PromptContext {
  issue?: IssueCtx;
  agent: AgentCtx;
  workspace?: WorkspaceCtx;
  task: TaskCtx;
  /** null on first attempt; >=1 when this is a retry or continuation. */
  attempt: number | null;
  /** True when this run is resuming the same CLI session as the previous attempt. */
  continuation: boolean;
  /** The trigger comment's content + metadata for comment-triggered prompts. */
  triggerComment?: {
    id: string;
    content: string;
    authorKind: "member" | "agent";
    authorName: string;
  };
  triggerSummary?: string;
  /** Set on retry attempts so the template can adapt the instructions. */
  lastError?: { kind: string; message: string };
}

export function renderPrompt(template: string, ctx: PromptContext): string {
  let parsed: Template[];
  try {
    parsed = engine.parse(template);
  } catch (err) {
    throw new PromptRenderError(`prompt template parse failed: ${(err as Error).message}`, {
      cause: err,
    });
  }
  try {
    return engine.renderSync(parsed, ctx as unknown as Record<string, unknown>);
  } catch (err) {
    throw new PromptRenderError(`prompt template render failed: ${(err as Error).message}`, {
      cause: err,
    });
  }
}

/**
 * Trigger kinds map 1:1 to keys on `agent.prompt_templates`. Tracker writes
 * (issue/comment/etc.) live in the agent's tool layer; the template itself
 * just shapes the per-turn nudge.
 */
export type PromptKind = "issue" | "comment" | "quick_create" | "autopilot" | "chat";

export type PromptTemplates = Partial<Record<PromptKind, string>>;

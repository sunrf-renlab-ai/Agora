import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { ClaudeBackend } from "./runner/claude";
import { CodexBackend } from "./runner/codex";
import type {
  Backend,
  ExecOptions,
  Message as BackendMessage,
  RunResult as BackendResult,
  TokenUsage,
} from "./runner/core";
import { GeminiBackend } from "./runner/gemini";
import { HermesBackend } from "./runner/hermes";
import { OpenclawBackend } from "./runner/openclaw";
import { type TaskContext, injectRuntimeConfig } from "./runtime-config";
import { findSedimentCandidate, postSedimentSkill } from "./skill-sediment";

/**
 * Per-task workdirs MUST live under this root. Defaults to the system temp
 * directory, but operators can pin it (e.g. to a dedicated SSD volume) via
 * `AGORA_WORKDIR_ROOT`. Safety invariant: before spawning the
 * agent we assert `workDir.startsWith(root + sep)` so a compromised
 * priorWorkDir can never trick the runner into running the CLI inside `/etc`
 * or `~/.ssh`.
 */
function workspaceRoot(): string {
  return resolve(process.env.AGORA_WORKDIR_ROOT || tmpdir());
}

function assertInsideWorkspaceRoot(workDir: string): void {
  const root = workspaceRoot();
  const abs = resolve(workDir);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (!abs.startsWith(prefix) && abs !== root) {
    throw new Error(
      `workspace_invariant_violation: workDir=${abs} is not inside AGORA_WORKDIR_ROOT=${root}`,
    );
  }
}

// One per-task execution message the runner emits during a run. Forwarded to
// the daemon so the server's task_message timeline is populated as the agent
// works. Stream-json backends (claude/codex/gemini/openclaw/hermes) now emit
// real-time tool_use/tool_result messages — not just the final summary.
export interface RunnerMessage {
  kind: "stdout" | "stderr" | "tool_use" | "tool_result" | "assistant" | "system";
  content: unknown;
}

export interface RunArgs {
  cliKind: string;
  taskId: string;
  agentId: string;
  workspaceId: string;
  serverUrl: string;
  taskToken: string;
  prompt: string;
  priorSessionId: string | null;
  priorWorkDir: string | null;
  customEnv: Record<string, string>;
  customArgs: string[];
  model: string | null;
  /** Set when this is a quick-create task. The CLI uses this to stamp
   *  origin_type=quick_create + origin_id on the new issue so the server's
   *  completion handler can find it deterministically. */
  quickCreateTaskId?: string | null;
  /** Set when this task was re-enqueued by the retry/rerun system. Used to
   *  suppress skill sedimentation on reruns. */
  parentTaskId?: string | null;
  /** The agent owner's GitHub token (when they connected GitHub). Injected
   *  into the CLI env as GH_TOKEN/GITHUB_TOKEN so the agent can git/gh as
   *  that user. */
  githubToken?: string | null;
  /** When provided, the runner writes a CLAUDE.md meta-skill file into the
   *  workdir before spawning the CLI. */
  taskContext?: TaskContext;
  onSpawn?: (pid: number) => void;
  onExit?: (pid: number) => void;
  /** Emitted as the runner observes agent-side messages. */
  onMessage?: (message: RunnerMessage) => void;
}

/**
 * Token + cost usage normalized across the 5 backends. Each backend reports
 * per-model usage; the adapter aggregates the first model's totals here for
 * the legacy server-side schema.
 */
export interface RunUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  totalCostUsd: number | null;
  durationMs: number | null;
  numTurns: number | null;
  model: string | null;
}

export interface RunResult {
  status: "completed" | "failed";
  exitCode: number;
  stdout: string;
  stderr: string;
  sessionId: string | null;
  workDir: string;
  lastMessage: string | null;
  usage: RunUsage | null;
  error?: string;
}

export interface Runner {
  run(args: RunArgs): Promise<RunResult>;
}

/**
 * Adapter that wraps any `Backend` (returns Session{messages,
 * result}) in the daemon's legacy `Runner` (returns flat RunResult). Handles
 * workdir creation, runtime-config injection, env wiring, message stream
 * fan-out to onMessage, and final-result shape conversion. Sediment scan
 * runs on completed runs so SKILL.md drops still trigger.
 */
class BackendAdapter implements Runner {
  constructor(
    private readonly cliKind: string,
    private readonly backend: Backend,
  ) {}

  async run(args: RunArgs): Promise<RunResult> {
    const root = workspaceRoot();
    const workDir = args.priorWorkDir ?? (await mkdtemp(join(root, `agora-${args.taskId}-`)));
    assertInsideWorkspaceRoot(workDir);

    // Write CLAUDE.md before spawn so the agent picks it up natively. The
    // runtime-config skill is the durable half of the two-layer prompt; the
    // per-turn prompt is just a thin trigger nudge.
    if (args.taskContext) {
      try {
        await injectRuntimeConfig(workDir, args.taskContext);
      } catch (e) {
        console.warn(
          `[agorad] injectRuntimeConfig failed for task ${args.taskId}: ${(e as Error).message}`,
        );
      }
    }

    const customEnv: Record<string, string> = {
      ...args.customEnv,
      AGORA_TOKEN: args.taskToken,
      AGORA_SERVER_URL: args.serverUrl,
      AGORA_WORKSPACE_ID: args.workspaceId,
      AGORA_AGENT_ID: args.agentId,
      AGORA_TASK_ID: args.taskId,
      ...(args.quickCreateTaskId ? { AGORA_QUICK_CREATE_TASK_ID: args.quickCreateTaskId } : {}),
      // The agent owner's GitHub token, so `gh` (GH_TOKEN) and git/library
      // credential helpers (GITHUB_TOKEN) authenticate as that user.
      ...(args.githubToken
        ? { GH_TOKEN: args.githubToken, GITHUB_TOKEN: args.githubToken }
        : {}),
    };

    const sedimentBaseline = new Date();

    const opts: ExecOptions = {
      cwd: workDir,
      model: args.model ?? undefined,
      resumeSessionId: args.priorSessionId ?? undefined,
      customArgs: args.customArgs,
      customEnv,
      onSpawn: args.onSpawn,
      onExit: args.onExit,
    };

    const session = this.backend.execute(args.prompt, opts);

    // Drain messages → forward to onMessage as RunnerMessage frames.
    const drainPromise = (async () => {
      try {
        for await (const m of session.messages) {
          forwardMessage(m, args.onMessage);
        }
      } catch (e) {
        // Don't propagate — final result still resolves.
        console.debug(
          `[agorad] adapter drain error (non-fatal): ${(e as Error).message.slice(0, 200)}`,
        );
      }
    })();

    const result: BackendResult = await session.result;
    await drainPromise;

    // Sediment SKILL.md if the agent dropped one. Best-effort, never throws.
    if (result.status === "completed" && !args.parentTaskId) {
      try {
        const candidate = await findSedimentCandidate(workDir, sedimentBaseline);
        if (candidate) {
          await postSedimentSkill({
            serverUrl: args.serverUrl,
            taskToken: args.taskToken,
            taskId: args.taskId,
            content: candidate.content,
          });
        }
      } catch (e) {
        console.debug(
          `[agorad] adapter sediment scan failed (non-fatal): ${(e as Error).message.slice(0, 200)}`,
        );
      }
    }

    // System frame so the timeline isn't empty on failure.
    if (args.onMessage) {
      try {
        args.onMessage({
          kind: "system",
          content: {
            text:
              result.status === "completed"
                ? "run completed"
                : `run ${result.status}${result.error ? `: ${result.error}` : ""}`,
          },
        });
      } catch (e) {
        console.debug(
          `[agorad] onMessage system frame error (non-fatal): ${(e as Error).message.slice(0, 200)}`,
        );
      }
    }

    const exitCode =
      result.status === "completed" ? 0 : result.status === "cancelled" ? 130 : 1;
    return {
      status: result.status === "completed" ? "completed" : "failed",
      exitCode,
      stdout: result.output,
      stderr: result.error ?? "",
      sessionId: result.sessionId ?? null,
      workDir,
      lastMessage: result.output ? result.output : null,
      usage: legacyUsage(result),
      error: result.status === "completed" ? undefined : (result.error ?? `status=${result.status}`),
    };
  }
}

function forwardMessage(m: BackendMessage, onMessage?: (msg: RunnerMessage) => void): void {
  if (!onMessage) return;
  switch (m.type) {
    case "text":
      onMessage({ kind: "assistant", content: { text: m.content ?? "" } });
      break;
    case "thinking":
      onMessage({ kind: "assistant", content: { type: "thinking", text: m.content ?? "" } });
      break;
    case "tool-use":
      onMessage({
        kind: "tool_use",
        content: { tool: m.tool, callId: m.callId, input: m.input ?? {} },
      });
      break;
    case "tool-result":
      onMessage({
        kind: "tool_result",
        content: { tool: m.tool, callId: m.callId, output: m.output ?? "" },
      });
      break;
    case "error":
      onMessage({ kind: "stderr", content: { text: m.content ?? "" } });
      break;
    case "log":
      onMessage({
        kind: "system",
        content: { type: "log", level: m.level, text: m.content ?? "" },
      });
      break;
    case "status":
      onMessage({
        kind: "system",
        content: { type: "status", status: m.status, sessionId: m.sessionId },
      });
      break;
  }
}

function legacyUsage(result: BackendResult): RunUsage | null {
  const entries = Object.entries(result.usageByModel);
  if (entries.length === 0) return null;
  // Sum all models, report the first model name. Most runs are single-model.
  const sum: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const [, u] of entries) {
    sum.inputTokens += u.inputTokens;
    sum.outputTokens += u.outputTokens;
    sum.cacheReadTokens += u.cacheReadTokens;
    sum.cacheWriteTokens += u.cacheWriteTokens;
  }
  const firstEntry = entries[0];
  if (!firstEntry) return null;
  const [model] = firstEntry;
  return {
    inputTokens: sum.inputTokens || null,
    outputTokens: sum.outputTokens || null,
    cacheReadTokens: sum.cacheReadTokens || null,
    cacheCreationTokens: sum.cacheWriteTokens || null,
    totalCostUsd: null,
    durationMs: result.durationMs || null,
    numTurns: null,
    model: model && model !== "unknown" ? model : null,
  };
}

/**
 * Back-compat re-export: the existing test suite imports
 * `extractClaudeUsage(payload)` to assert the runner's old single-shot JSON
 * parser. With the new stream-json backend that path is gone, but tests still
 * call this helper. Keep a minimal implementation that mirrors the old
 * behavior (parse Claude's `--output-format json` tail).
 */
export function extractClaudeUsage(payload: Record<string, unknown>): RunUsage {
  const u = (payload.usage ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheCreationTokens: num(u.cache_creation_input_tokens),
    totalCostUsd: num(payload.total_cost_usd),
    durationMs: num(payload.duration_ms),
    numTurns: num(payload.num_turns),
    model: str(payload.model_id) ?? str(payload.model),
  };
}

export function pickRunner(cliKind: string): Runner {
  switch (cliKind) {
    case "claude_code":
      return new BackendAdapter("claude_code", new ClaudeBackend({ executablePath: "claude" }));
    case "codex":
      return new BackendAdapter("codex", new CodexBackend({ executablePath: "codex" }));
    case "gemini":
      return new BackendAdapter("gemini", new GeminiBackend({ executablePath: "gemini" }));
    case "openclaw":
      return new BackendAdapter("openclaw", new OpenclawBackend({ executablePath: "openclaw" }));
    case "hermes":
      return new BackendAdapter("hermes", new HermesBackend({ executablePath: "hermes" }));
    default:
      throw new Error(`Unsupported cliKind: ${cliKind}`);
  }
}

/** Legacy alias kept so existing tests that import `ClaudeCodeRunner` still
 *  compile. New code should use `pickRunner("claude_code")`. */
export class ClaudeCodeRunner extends BackendAdapter {
  constructor() {
    super("claude_code", new ClaudeBackend({ executablePath: "claude" }));
  }
}

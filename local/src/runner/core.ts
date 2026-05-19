// Unified Backend interface for executing prompts via local coding-agent CLIs
// (Claude Code, Codex, Copilot, OpenCode, OpenClaw, Hermes, Gemini, Pi, Cursor,
// Kimi, Kiro).

export type CliKind =
  | "claude_code"
  | "codex"
  | "copilot"
  | "cursor"
  | "gemini"
  | "hermes"
  | "kimi"
  | "kiro"
  | "openclaw"
  | "opencode"
  | "pi";

export const CLI_KINDS: readonly CliKind[] = [
  "claude_code",
  "codex",
  "copilot",
  "cursor",
  "gemini",
  "hermes",
  "kimi",
  "kiro",
  "openclaw",
  "opencode",
  "pi",
] as const;

export interface BackendConfig {
  /** Resolved path to the CLI binary. */
  executablePath: string;
  /** Extra environment variables (merged on top of process.env). */
  env?: Record<string, string>;
  /** Optional logger; defaults to console. */
  logger?: Logger;
}

export interface Logger {
  debug: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

export const defaultLogger: Logger = {
  debug: (msg, ...args) => console.debug(`[runner] ${msg}`, ...args),
  info: (msg, ...args) => console.log(`[runner] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[runner] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[runner] ${msg}`, ...args),
};

export interface ExecOptions {
  cwd: string;
  model?: string | null;
  systemPrompt?: string;
  maxTurns?: number;
  /** Hard wall-clock deadline. 0/undefined = no limit. */
  timeoutMs?: number;
  /** Inactivity deadline measured from last semantic message. 0 = no limit. */
  semanticInactivityMs?: number;
  resumeSessionId?: string | null;
  /** Daemon-wide default args appended before customArgs. Currently used by claude+codex. */
  extraArgs?: string[];
  /** Per-agent args appended after extraArgs. */
  customArgs?: string[];
  customEnv?: Record<string, string>;
  /** MCP config blob passed to backends that support --mcp-config. */
  mcpConfig?: Record<string, unknown> | null;

  onSpawn?: (pid: number) => void;
  onExit?: (pid: number) => void;
}

export type MessageType =
  | "text"
  | "thinking"
  | "tool-use"
  | "tool-result"
  | "status"
  | "error"
  | "log";

export interface Message {
  type: MessageType;
  /** Text content (for text/error/log). */
  content?: string;
  /** Tool name (for tool-use / tool-result). */
  tool?: string;
  /** Tool call ID (for tool-use / tool-result). */
  callId?: string;
  /** Tool input (for tool-use). */
  input?: Record<string, unknown>;
  /** Tool output (for tool-result). */
  output?: string;
  /** Agent status string (for status). */
  status?: string;
  /** Log level (for log). */
  level?: string;
  /** Backend session id (for status), allows early resume-pointer pinning. */
  sessionId?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type RunStatus =
  | "completed"
  | "failed"
  | "aborted"
  | "timeout"
  | "cancelled";

export interface RunResult {
  status: RunStatus;
  output: string;
  error?: string;
  durationMs: number;
  sessionId?: string;
  /** Per-model usage map (model name → tokens). */
  usageByModel: Record<string, TokenUsage>;
}

export interface Session {
  /** Stream of messages as the agent works. Closes when the agent finishes. */
  messages: AsyncIterable<Message>;
  /** Resolves once with the final outcome. */
  result: Promise<RunResult>;
  /** Cooperative cancel: terminates the child process and resolves result with status="cancelled". */
  cancel: () => void;
}

export interface Backend {
  execute(prompt: string, opts: ExecOptions): Session;
}

/**
 * User-visible launch skeleton — what the daemon spawns before customArgs.
 */
export const LAUNCH_HEADERS: Record<CliKind, string> = {
  claude_code: "claude (stream-json)",
  codex: "codex app-server",
  copilot: "copilot (json)",
  cursor: "cursor-agent (stream-json)",
  gemini: "gemini (stream-json)",
  hermes: "hermes acp",
  kimi: "kimi acp",
  kiro: "kiro-cli acp",
  openclaw: "openclaw agent (json)",
  opencode: "opencode run (json)",
  pi: "pi (json mode)",
};

export function launchHeader(kind: CliKind): string {
  return LAUNCH_HEADERS[kind] ?? "";
}

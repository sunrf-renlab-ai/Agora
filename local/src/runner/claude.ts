// Claude Code runner backend.
// Spawns the Claude Code CLI with bidirectional stream-json:
//   --output-format stream-json --input-format stream-json
//   --permission-mode bypassPermissions
// Sends the user prompt as a JSON envelope on stdin, then closes stdin.
// Reads stream-json events on stdout: assistant / user / system / result /
// log / control_request. Auto-approves tool uses by writing control_response
// frames back to stdin.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AsyncQueue } from "./async-queue";
import { type BlockedArgs, filterCustomArgs } from "./blocked-args";
import {
  type Backend,
  type BackendConfig,
  type ExecOptions,
  type Message,
  type RunResult,
  type Session,
  type TokenUsage,
  defaultLogger,
} from "./core";
import { readNdjson } from "./ndjson";
import { spawn } from "./spawn";
import { withAgentStderr } from "./stderr-tail";

interface ClaudeSDKMessage {
  type?: string;
  message?: ClaudeMessageContent | Record<string, unknown>;
  subtype?: string;
  session_id?: string;
  // result fields
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
  // log fields
  log?: { level?: string; message?: string };
  // control request fields
  request_id?: string;
  request?: ClaudeControlRequestPayload;
}

interface ClaudeMessageContent {
  role?: string;
  model?: string;
  content?: ClaudeContentBlock[];
  usage?: ClaudeUsage;
}

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ClaudeContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

interface ClaudeControlRequestPayload {
  subtype?: string;
  tool_name?: string;
  input?: Record<string, unknown>;
}

/** Flags blocked from user-supplied customArgs for the Claude Code backend. */
export const claudeBlockedArgs: BlockedArgs = {
  "-p": "standalone",
  "--output-format": "with-value",
  "--input-format": "with-value",
  "--permission-mode": "with-value",
  "--mcp-config": "with-value",
};

export function buildClaudeArgs(opts: ExecOptions): string[] {
  const args: string[] = [
    "-p",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.maxTurns && opts.maxTurns > 0) args.push("--max-turns", String(opts.maxTurns));
  if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
  args.push(...filterCustomArgs(opts.extraArgs ?? [], claudeBlockedArgs));
  args.push(...filterCustomArgs(opts.customArgs ?? [], claudeBlockedArgs));
  return args;
}

export function buildClaudeInput(prompt: string): string {
  const payload = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
  };
  return `${JSON.stringify(payload)}\n`;
}

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

const FILTERED_CHILD_ENV_PREFIXES = ["CLAUDECODE_", "CLAUDE_CODE_"];
const FILTERED_CHILD_ENV_KEYS = new Set(["CLAUDECODE"]);

function shouldKeepEnv(key: string): boolean {
  if (FILTERED_CHILD_ENV_KEYS.has(key)) return false;
  for (const p of FILTERED_CHILD_ENV_PREFIXES) {
    if (key.startsWith(p)) return false;
  }
  return true;
}

function buildClaudeEnv(extra: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string" && shouldKeepEnv(k)) out[k] = v;
  }
  if (extra) Object.assign(out, extra);
  return out;
}

/**
 * Resolves the effective session id. When the caller requested --resume but
 * claude emitted a fresh, different session id AND the run failed, the
 * resume did not land. Return "" so the daemon's retry-with-fresh fallback
 * can trigger.
 */
export function resolveSessionId(
  requestedResume: string | null | undefined,
  emitted: string,
  failed: boolean,
): string {
  if (failed && requestedResume && emitted && emitted !== requestedResume) return "";
  return emitted;
}

export class ClaudeBackend implements Backend {
  constructor(private readonly cfg: BackendConfig) {}

  execute(prompt: string, opts: ExecOptions): Session {
    const logger = this.cfg.logger ?? defaultLogger;
    const execPath = this.cfg.executablePath || "claude";

    const messages = new AsyncQueue<Message>();
    const startedAt = Date.now();
    let cancelled = false;
    let timedOut = false;
    let mcpDir: string | null = null;
    const cleanups: Array<() => Promise<void> | void> = [];

    const args = buildClaudeArgs(opts);

    const result: Promise<RunResult> = (async () => {
      // MCP config gets a temp file passed via --mcp-config.
      if (opts.mcpConfig && Object.keys(opts.mcpConfig).length > 0) {
        try {
          mcpDir = await mkdtemp(join(tmpdir(), "agora-mcp-"));
          const mcpPath = join(mcpDir, "mcp.json");
          await writeFile(mcpPath, JSON.stringify(opts.mcpConfig), "utf8");
          args.push("--mcp-config", mcpPath);
          cleanups.push(async () => {
            if (mcpDir) await rm(mcpDir, { recursive: true, force: true });
          });
        } catch (e) {
          messages.close(e as Error);
          return failedResult(`write mcp config: ${(e as Error).message}`, startedAt);
        }
      }

      logger.info(`agent command exec=${execPath} args=${JSON.stringify(args)}`);

      const env = { ...buildClaudeEnv(this.cfg.env), ...(opts.customEnv ?? {}) };
      const { proc, stderrTail } = spawn({
        cmd: [execPath, ...args],
        cwd: opts.cwd,
        env,
        onSpawn: opts.onSpawn,
        onExit: opts.onExit,
        stdin: "pipe",
        captureStderrTail: true,
      });
      logger.info(`claude started pid=${proc.pid} cwd=${opts.cwd} model=${opts.model ?? ""}`);

      const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill("SIGTERM");
        } catch {}
      }, timeoutMs);

      // Write the prompt envelope, then keep stdin open so we can write
      // control_response frames back when claude asks to use a tool.
      const stdinWriter =
        proc.stdin && typeof proc.stdin !== "number"
          ? (proc.stdin as { write: (s: string) => unknown; end?: () => unknown })
          : null;
      if (!stdinWriter) {
        clearTimeout(timeoutHandle);
        return failedResult("claude stdin pipe unavailable", startedAt);
      }
      try {
        stdinWriter.write(buildClaudeInput(prompt));
      } catch (e) {
        clearTimeout(timeoutHandle);
        await proc.exited;
        return failedResult(
          withAgentStderr(`write claude input: ${(e as Error).message}`, "claude", stderrTail?.tail() ?? ""),
          startedAt,
        );
      }

      let output = "";
      let sessionId = "";
      const usage: Record<string, TokenUsage> = {};
      let status: RunResult["status"] = "completed";
      let errorMsg = "";

      const writeControlResponse = (msg: ClaudeSDKMessage): void => {
        const inputMap = msg.request?.input ?? {};
        const response = {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: msg.request_id,
            response: { behavior: "allow", updatedInput: inputMap },
          },
        };
        try {
          stdinWriter.write(`${JSON.stringify(response)}\n`);
        } catch (e) {
          logger.warn(`claude: failed to write control response: ${(e as Error).message}`);
        }
      };

      try {
        const stdout = proc.stdout as ReadableStream<Uint8Array> | null;
        if (stdout) {
          for await (const evt of readNdjson<ClaudeSDKMessage>(stdout, {
            maxLineBytes: 10 * 1024 * 1024,
          })) {
            switch (evt.type) {
              case "assistant":
                handleAssistant(evt, messages, (t) => (output += t), usage);
                break;
              case "user":
                handleUser(evt, messages);
                break;
              case "system":
                if (evt.session_id) sessionId = evt.session_id;
                messages.push({ type: "status", status: "running", sessionId });
                break;
              case "result":
                if (evt.session_id) sessionId = evt.session_id;
                if (typeof evt.result === "string" && evt.result.length > 0) {
                  output = evt.result;
                }
                if (evt.is_error) {
                  status = "failed";
                  errorMsg = evt.result ?? "claude reported error";
                }
                // Close stdin so claude exits cleanly once the result arrives.
                try {
                  stdinWriter.end?.();
                } catch {}
                break;
              case "log":
                if (evt.log) {
                  messages.push({
                    type: "log",
                    level: evt.log.level,
                    content: evt.log.message,
                  });
                }
                break;
              case "control_request":
                writeControlResponse(evt);
                break;
            }
          }
        }
      } catch (e) {
        status = "failed";
        errorMsg = (e as Error).message;
      }

      const exitCode = await proc.exited;
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startedAt;

      if (cancelled) {
        status = "cancelled";
        errorMsg = "execution cancelled";
      } else if (timedOut) {
        status = "timeout";
        errorMsg = `claude timed out after ${timeoutMs}ms`;
      } else if (exitCode !== 0 && status === "completed") {
        status = "failed";
        errorMsg = `claude exited with code ${exitCode}`;
      }

      if (errorMsg) {
        errorMsg = withAgentStderr(errorMsg, "claude", stderrTail?.tail() ?? "");
      }

      logger.info(
        `claude finished pid=${proc.pid} status=${status} duration=${durationMs}ms`,
      );

      const reportedSessionId = resolveSessionId(
        opts.resumeSessionId,
        sessionId,
        status === "failed",
      );
      if (reportedSessionId !== sessionId) {
        logger.info(
          `claude resume did not land; clearing session id (requested=${opts.resumeSessionId} emitted=${sessionId})`,
        );
      }

      messages.close();
      for (const fn of cleanups) {
        try {
          await fn();
        } catch {}
      }

      return {
        status,
        output,
        error: errorMsg || undefined,
        durationMs,
        sessionId: reportedSessionId || undefined,
        usageByModel: usage,
      };
    })();

    return {
      messages,
      result,
      cancel: () => {
        cancelled = true;
      },
    };
  }
}

function handleAssistant(
  evt: ClaudeSDKMessage,
  messages: AsyncQueue<Message>,
  appendText: (text: string) => void,
  usage: Record<string, TokenUsage>,
): void {
  const content = evt.message as ClaudeMessageContent | undefined;
  if (!content) return;

  if (content.usage && content.model) {
    const u = usage[content.model] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    u.inputTokens += content.usage.input_tokens ?? 0;
    u.outputTokens += content.usage.output_tokens ?? 0;
    u.cacheReadTokens += content.usage.cache_read_input_tokens ?? 0;
    u.cacheWriteTokens += content.usage.cache_creation_input_tokens ?? 0;
    usage[content.model] = u;
  }

  for (const block of content.content ?? []) {
    switch (block.type) {
      case "text":
        if (block.text) {
          appendText(block.text);
          messages.push({ type: "text", content: block.text });
        }
        break;
      case "thinking":
        if (block.text) messages.push({ type: "thinking", content: block.text });
        break;
      case "tool_use":
        messages.push({
          type: "tool-use",
          tool: block.name,
          callId: block.id,
          input: block.input,
        });
        break;
    }
  }
}

function handleUser(evt: ClaudeSDKMessage, messages: AsyncQueue<Message>): void {
  const content = evt.message as ClaudeMessageContent | undefined;
  if (!content) return;
  for (const block of content.content ?? []) {
    if (block.type === "tool_result") {
      const out =
        typeof block.content === "string"
          ? block.content
          : block.content !== undefined
            ? JSON.stringify(block.content)
            : "";
      messages.push({
        type: "tool-result",
        callId: block.tool_use_id,
        output: out,
      });
    }
  }
}

function failedResult(error: string, startedAt: number): RunResult {
  return {
    status: "failed",
    output: "",
    error,
    durationMs: Date.now() - startedAt,
    usageByModel: {},
  };
}

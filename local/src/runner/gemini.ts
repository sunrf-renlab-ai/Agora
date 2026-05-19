// Gemini runner backend.
// Spawns the Gemini CLI with `-o stream-json` and parses NDJSON events.

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

interface GeminiStreamEvent {
  type?: string;
  timestamp?: string;
  session_id?: string;
  model?: string;
  // message
  role?: string;
  content?: string;
  delta?: boolean;
  // tool_use
  tool_name?: string;
  tool_id?: string;
  parameters?: Record<string, unknown>;
  // tool_result
  status?: string;
  output?: string;
  // error
  severity?: string;
  message?: string;
  // result
  error?: { type?: string; message?: string };
  stats?: GeminiStreamStats;
}

interface GeminiStreamStats {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
  tool_calls?: number;
  models?: Record<string, GeminiModelStats>;
}

interface GeminiModelStats {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached?: number;
}

/** Flags blocked from user-supplied customArgs for the Gemini backend. */
export const geminiBlockedArgs: BlockedArgs = {
  "-p": "with-value", // non-interactive prompt
  "--yolo": "standalone", // auto-approve tool use
  "-o": "with-value", // stream-json output format
};

export function buildGeminiArgs(prompt: string, opts: ExecOptions): string[] {
  const args: string[] = ["-p", prompt, "--yolo", "-o", "stream-json"];
  if (opts.model) args.push("-m", opts.model);
  if (opts.resumeSessionId) args.push("-r", opts.resumeSessionId);
  args.push(...filterCustomArgs(opts.customArgs ?? [], geminiBlockedArgs));
  return args;
}

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export class GeminiBackend implements Backend {
  constructor(private readonly cfg: BackendConfig) {}

  execute(prompt: string, opts: ExecOptions): Session {
    const logger = this.cfg.logger ?? defaultLogger;
    const execPath = this.cfg.executablePath || "gemini";
    const args = buildGeminiArgs(prompt, opts);
    logger.info(`agent command exec=${execPath} args=${JSON.stringify(args)}`);

    const messages = new AsyncQueue<Message>();
    const startedAt = Date.now();
    let cancelled = false;
    let timedOut = false;

    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {}
    }, timeoutMs);

    const { proc, stderrTail } = spawn({
      cmd: [execPath, ...args],
      cwd: opts.cwd,
      env: { ...(this.cfg.env ?? {}), ...(opts.customEnv ?? {}) },
      onSpawn: opts.onSpawn,
      onExit: opts.onExit,
      stdin: "ignore",
      captureStderrTail: true,
    });
    logger.info(
      `gemini started pid=${proc.pid} cwd=${opts.cwd} model=${opts.model ?? ""}`,
    );

    const result: Promise<RunResult> = (async () => {
      let output = "";
      let sessionId = "";
      const usage: Record<string, TokenUsage> = {};
      let status: RunResult["status"] = "completed";
      let errorMsg = "";

      try {
        const stdout = proc.stdout as ReadableStream<Uint8Array> | null;
        if (stdout) {
          for await (const evt of readNdjson<GeminiStreamEvent>(stdout, {
            maxLineBytes: 10 * 1024 * 1024,
          })) {
            switch (evt.type) {
              case "init":
                if (evt.session_id) sessionId = evt.session_id;
                messages.push({ type: "status", status: "running" });
                break;
              case "message":
                if (evt.role === "assistant" && evt.content) {
                  output += evt.content;
                  messages.push({ type: "text", content: evt.content });
                }
                break;
              case "tool_use":
                messages.push({
                  type: "tool-use",
                  tool: evt.tool_name,
                  callId: evt.tool_id,
                  input: evt.parameters,
                });
                break;
              case "tool_result":
                messages.push({
                  type: "tool-result",
                  callId: evt.tool_id,
                  output: evt.output,
                });
                break;
              case "error":
                messages.push({ type: "error", content: evt.message });
                break;
              case "result":
                if (evt.status === "error" && evt.error) {
                  status = "failed";
                  errorMsg = evt.error.message ?? "gemini reported error";
                }
                if (evt.stats) accumulateUsage(usage, evt.stats);
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
        errorMsg = `gemini timed out after ${timeoutMs}ms`;
      } else if (exitCode !== 0 && status === "completed") {
        status = "failed";
        errorMsg = withAgentStderr(
          `gemini exited with code ${exitCode}`,
          "gemini",
          stderrTail?.tail() ?? "",
        );
      }

      logger.info(
        `gemini finished pid=${proc.pid} status=${status} duration=${durationMs}ms`,
      );

      messages.close();
      return {
        status,
        output,
        error: errorMsg || undefined,
        durationMs,
        sessionId: sessionId || undefined,
        usageByModel: usage,
      };
    })();

    return {
      messages,
      result,
      cancel: () => {
        cancelled = true;
        try {
          proc.kill("SIGTERM");
        } catch {}
      },
    };
  }
}

function accumulateUsage(
  usage: Record<string, TokenUsage>,
  stats: GeminiStreamStats,
): void {
  if (!stats.models) return;
  for (const [model, m] of Object.entries(stats.models)) {
    const cur = usage[model] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    cur.inputTokens += m.input_tokens ?? 0;
    cur.outputTokens += m.output_tokens ?? 0;
    cur.cacheReadTokens += m.cached ?? 0;
    usage[model] = cur;
  }
}

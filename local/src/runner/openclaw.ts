// OpenClaw runner backend.
// Spawns `openclaw agent --local --json --session-id <id> --message <prompt>`.
// JSON output goes to stderr; stdout carries logs. Stream is a mix of
// streaming NDJSON events and (older format) a single result blob with
// payloads + meta.

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
import { spawn } from "./spawn";
import { withAgentStderr } from "./stderr-tail";

/** Flags blocked from user-supplied customArgs for the OpenClaw backend. */
export const openclawBlockedArgs: BlockedArgs = {
  "--local": "standalone",
  "--json": "standalone",
  "--session-id": "with-value",
  "--message": "with-value",
  "--model": "with-value",
  "--system-prompt": "with-value",
};

interface OpenclawEvent {
  type?: string;
  sessionId?: string;
  text?: string;
  tool?: string;
  callId?: string;
  input?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  phase?: string;
  error?: { name?: string; data?: { message?: string }; message?: string };
  message?: string;
}

interface OpenclawResult {
  payloads?: Array<{ text?: string }>;
  meta?: {
    durationMs?: number;
    agentMeta?: Record<string, unknown>;
  };
}

function customArgsContains(args: readonly string[], flag: string): boolean {
  const eq = `${flag}=`;
  for (const a of args) {
    if (a === flag || a.startsWith(eq)) return true;
  }
  return false;
}

export function buildOpenclawArgs(
  prompt: string,
  sessionId: string,
  opts: ExecOptions,
): string[] {
  const args: string[] = ["agent", "--local", "--json", "--session-id", sessionId];
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    args.push("--timeout", String(Math.floor(opts.timeoutMs / 1000)));
  }
  const customArgs = filterCustomArgs(opts.customArgs ?? [], openclawBlockedArgs);
  if (opts.model && !customArgsContains(customArgs, "--agent")) {
    args.push("--agent", opts.model);
  }
  args.push(...customArgs);

  let message = prompt;
  if (opts.systemPrompt) message = `${opts.systemPrompt}\n\n${prompt}`;
  args.push("--message", message);
  return args;
}

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export class OpenclawBackend implements Backend {
  constructor(private readonly cfg: BackendConfig) {}

  execute(prompt: string, opts: ExecOptions): Session {
    const logger = this.cfg.logger ?? defaultLogger;
    const execPath = this.cfg.executablePath || "openclaw";

    const messages = new AsyncQueue<Message>();
    const startedAt = Date.now();
    let cancelled = false;
    let timedOut = false;

    const sessionId =
      opts.resumeSessionId && opts.resumeSessionId.length > 0
        ? opts.resumeSessionId
        : `agora-${process.hrtime.bigint().toString()}`;
    const args = buildOpenclawArgs(prompt, sessionId, opts);
    logger.info(`agent command exec=${execPath} args=${JSON.stringify(args)}`);

    const env = { ...(this.cfg.env ?? {}), ...(opts.customEnv ?? {}) };

    // openclaw writes JSON to stderr; pipe it normally (no tail capture
    // because stderr IS the protocol surface).
    const { proc } = spawn({
      cmd: [execPath, ...args],
      cwd: opts.cwd,
      env,
      onSpawn: opts.onSpawn,
      onExit: opts.onExit,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    logger.info(`openclaw started pid=${proc.pid} cwd=${opts.cwd} model=${opts.model ?? ""}`);

    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {}
    }, timeoutMs);

    // Drain stdout (logs) so the process doesn't block on a full pipe.
    const stdoutStream =
      proc.stdout && typeof proc.stdout !== "number"
        ? (proc.stdout as ReadableStream<Uint8Array>)
        : null;
    void drainAsLog(stdoutStream, logger, "[openclaw:stdout] ");

    const result: Promise<RunResult> = (async () => {
      const stderrBuf: string[] = [];
      let output = "";
      let resolvedSessionId = "";
      let model = "";
      let usage: TokenUsage = blankUsage();
      let status: RunResult["status"] = "completed";
      let errorMsg = "";
      let gotEvents = false;
      const rawLines: string[] = [];

      try {
        const stderr = proc.stderr as ReadableStream<Uint8Array> | null;
        if (stderr) {
          for await (const line of readLines(stderr, 10 * 1024 * 1024)) {
            stderrBuf.push(line);
            const trimmed = line.trim();
            if (trimmed === "") continue;

            // Streaming NDJSON event?
            const evt = tryParseEvent(trimmed);
            if (evt) {
              gotEvents = true;
              if (evt.sessionId) resolvedSessionId = evt.sessionId;
              switch (evt.type) {
                case "text":
                  if (evt.text) {
                    output += evt.text;
                    messages.push({ type: "text", content: evt.text });
                  }
                  break;
                case "tool_use":
                  messages.push({
                    type: "tool-use",
                    tool: evt.tool,
                    callId: evt.callId,
                    input: evt.input,
                  });
                  break;
                case "tool_result":
                  messages.push({
                    type: "tool-result",
                    tool: evt.tool,
                    callId: evt.callId,
                    output: evt.text,
                  });
                  break;
                case "error": {
                  const msg = errorMessage(evt);
                  logger.warn(`openclaw error event: ${msg}`);
                  messages.push({ type: "error", content: msg });
                  status = "failed";
                  errorMsg = msg;
                  break;
                }
                case "lifecycle": {
                  if (
                    evt.phase === "error" ||
                    evt.phase === "failed" ||
                    evt.phase === "cancelled"
                  ) {
                    const msg = errorMessage(evt);
                    logger.warn(`openclaw lifecycle ${evt.phase}: ${msg}`);
                    messages.push({ type: "error", content: msg });
                    status = "failed";
                    errorMsg = msg;
                  }
                  break;
                }
                case "step_start":
                  messages.push({ type: "status", status: "running" });
                  break;
                case "step_finish":
                  if (evt.usage) {
                    const u = parseUsage(evt.usage);
                    usage = sumUsage(usage, u);
                  }
                  break;
              }
              continue;
            }

            // Final result blob (legacy single-line format)?
            const res = tryParseResult(trimmed);
            if (res) {
              gotEvents = true;
              const r = consumeResult(res, messages, (t) => (output += t));
              if (r.sessionId) resolvedSessionId = r.sessionId;
              if (r.model) model = r.model;
              if (!isBlankUsage(r.usage)) usage = r.usage;
              continue;
            }

            // Non-JSON log line (or pretty-printed JSON fragment).
            logger.debug(`[openclaw:stderr] ${trimmed}`);
            rawLines.push(trimmed);
          }
        }
      } catch (e) {
        status = "failed";
        errorMsg = (e as Error).message;
      }

      // Pretty-printed JSON fallback when we got no events.
      if (!gotEvents && rawLines.length > 0) {
        const joined = rawLines.join("\n").trim();
        const r = tryParseResult(joined);
        if (r) {
          const c = consumeResult(r, messages, (t) => (output += t));
          if (c.sessionId) resolvedSessionId = c.sessionId;
          if (c.model) model = c.model;
          if (!isBlankUsage(c.usage)) usage = c.usage;
        } else {
          // Search for a JSON blob starting at a '{' line.
          for (let i = 0; i < rawLines.length; i++) {
            const l = rawLines[i];
            if (l && l.startsWith("{")) {
              const candidate = rawLines.slice(i).join("\n").trim();
              const c2 = tryParseResult(candidate);
              if (c2) {
                const cr = consumeResult(c2, messages, (t) => (output += t));
                if (cr.sessionId) resolvedSessionId = cr.sessionId;
                if (cr.model) model = cr.model;
                if (!isBlankUsage(cr.usage)) usage = cr.usage;
                gotEvents = true;
              }
              break;
            }
          }
          if (!gotEvents) {
            output = joined;
          }
        }
      }

      const exitCode = await proc.exited;
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startedAt;

      if (cancelled) {
        status = "cancelled";
        errorMsg = "execution cancelled";
      } else if (timedOut) {
        status = "timeout";
        errorMsg = `openclaw timed out after ${timeoutMs}ms`;
      } else if (exitCode !== 0 && status === "completed") {
        status = "failed";
        errorMsg = withAgentStderr(
          `openclaw exited with code ${exitCode}`,
          "openclaw",
          stderrBuf.slice(-20).join("\n").trim(),
        );
      }

      logger.info(
        `openclaw finished pid=${proc.pid} status=${status} duration=${durationMs}ms`,
      );

      // Build per-model usage map. Prefer openclaw-reported model, then
      // opts.model (which is the openclaw agent name for this backend),
      // then "unknown".
      const usageByModel: Record<string, TokenUsage> = {};
      if (!isBlankUsage(usage)) {
        const key = model || opts.model || "unknown";
        usageByModel[key] = usage;
      }

      messages.close();
      return {
        status,
        output,
        error: errorMsg || undefined,
        durationMs,
        sessionId: resolvedSessionId || undefined,
        usageByModel,
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

// ── Helpers ──

function blankUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function isBlankUsage(u: TokenUsage): boolean {
  return (
    u.inputTokens === 0 &&
    u.outputTokens === 0 &&
    u.cacheReadTokens === 0 &&
    u.cacheWriteTokens === 0
  );
}

function sumUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

function int64FirstOf(data: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "number" && Number.isFinite(v) && v !== 0) return Math.trunc(v);
  }
  return 0;
}

function parseUsage(data: Record<string, unknown>): TokenUsage {
  return {
    inputTokens: int64FirstOf(data, "input", "inputTokens", "input_tokens"),
    outputTokens: int64FirstOf(data, "output", "outputTokens", "output_tokens"),
    cacheReadTokens: int64FirstOf(
      data,
      "cacheRead",
      "cachedInputTokens",
      "cached_input_tokens",
      "cache_read",
      "cache_read_input_tokens",
    ),
    cacheWriteTokens: int64FirstOf(
      data,
      "cacheWrite",
      "cacheCreationInputTokens",
      "cache_creation_input_tokens",
      "cache_write",
    ),
  };
}

function errorMessage(evt: OpenclawEvent): string {
  if (evt.error) {
    if (evt.error.data?.message) return evt.error.data.message;
    if (evt.error.message) return evt.error.message;
    if (evt.error.name) return evt.error.name;
  }
  if (evt.text) return evt.text;
  if (evt.message) return evt.message;
  return "unknown openclaw error";
}

function tryParseEvent(line: string): OpenclawEvent | null {
  if (!line.startsWith("{")) return null;
  try {
    const evt = JSON.parse(line) as OpenclawEvent;
    if (!evt.type) return null;
    return evt;
  } catch {
    return null;
  }
}

function tryParseResult(raw: string): OpenclawResult | null {
  if (!raw.startsWith("{")) return null;
  try {
    const r = JSON.parse(raw) as OpenclawResult;
    if (!r.payloads && !(r.meta && r.meta.durationMs)) return null;
    return r;
  } catch {
    return null;
  }
}

function consumeResult(
  r: OpenclawResult,
  messages: AsyncQueue<Message>,
  appendText: (s: string) => void,
): { sessionId: string; model: string; usage: TokenUsage } {
  for (const p of r.payloads ?? []) {
    if (p.text) {
      appendText(p.text);
      messages.push({ type: "text", content: p.text });
    }
  }
  let sessionId = "";
  let model = "";
  let usage = blankUsage();
  const am = r.meta?.agentMeta;
  if (am) {
    if (typeof am.sessionId === "string") sessionId = am.sessionId;
    if (typeof am.model === "string") model = am.model.trim();
    if (am.usage && typeof am.usage === "object") {
      usage = parseUsage(am.usage as Record<string, unknown>);
    }
  }
  return { sessionId, model, usage };
}

async function* readLines(
  stream: ReadableStream<Uint8Array>,
  maxLine: number,
): AsyncGenerator<string, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value && value.length > 0) buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line.length <= maxLine) yield line;
        nl = buf.indexOf("\n");
      }
      if (done) {
        if (buf.length > 0 && buf.length <= maxLine) yield buf;
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function drainAsLog(
  stream: ReadableStream<Uint8Array> | null,
  logger: { debug: (m: string) => void },
  prefix: string,
): Promise<void> {
  if (!stream) return;
  try {
    for await (const line of readLines(stream, 10 * 1024 * 1024)) {
      const t = line.trim();
      if (t) logger.debug(`${prefix}${t}`);
    }
  } catch {}
}

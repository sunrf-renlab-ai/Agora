// Hermes runner backend.
// Spawns `hermes acp` and drives an ACP (Agent Communication Protocol)
// session over stdin/stdout JSON-RPC 2.0:
//   initialize → session/new|resume → session/set_model → session/prompt
//   → wait for PromptResponse + session/update notifications.
// Auto-approves agent→client `session/request_permission` requests.
// Sniffs stderr for provider-level errors so HTTP 4xx/5xx aren't lost
// behind a misleading "empty output".

import { AsyncQueue } from "./async-queue";
import { type BlockedArgs, filterCustomArgs } from "./blocked-args";
import {
  type Backend,
  type BackendConfig,
  type ExecOptions,
  type Logger,
  type Message,
  type RunResult,
  type Session,
  type TokenUsage,
  defaultLogger,
} from "./core";
import { spawn } from "./spawn";
import { withAgentStderr } from "./stderr-tail";

/** Flags blocked from user-supplied customArgs for the Hermes backend. */
export const hermesBlockedArgs: BlockedArgs = {
  acp: "standalone",
};

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  method: string;
}

interface PromptResult {
  stopReason: string;
  usage: TokenUsage;
}

interface PendingToolCall {
  toolName: string;
  input: Record<string, unknown> | null;
  argsText: string;
  emitted: boolean;
}

export class HermesBackend implements Backend {
  constructor(private readonly cfg: BackendConfig) {}

  execute(prompt: string, opts: ExecOptions): Session {
    const logger = this.cfg.logger ?? defaultLogger;
    const execPath = this.cfg.executablePath || "hermes";
    const args = ["acp", ...filterCustomArgs(opts.customArgs ?? [], hermesBlockedArgs)];
    logger.info(`agent command exec=${execPath} args=${JSON.stringify(args)}`);

    const messages = new AsyncQueue<Message>();
    const startedAt = Date.now();
    let cancelled = false;
    let timedOut = false;

    const env = { ...(this.cfg.env ?? {}), HERMES_YOLO_MODE: "1", ...(opts.customEnv ?? {}) };
    const sniffer = new ACPProviderErrorSniffer("hermes");

    const { proc, stderrTail } = spawn({
      cmd: [execPath, ...args],
      cwd: opts.cwd,
      env,
      onSpawn: opts.onSpawn,
      onExit: opts.onExit,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Pipe stderr to both: log + sniffer + (small) tail buffer.
    void pipeStderr(
      proc.stderr && typeof proc.stderr !== "number"
        ? (proc.stderr as ReadableStream<Uint8Array>)
        : null,
      logger,
      sniffer,
    );

    logger.info(`hermes acp started pid=${proc.pid} cwd=${opts.cwd}`);

    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {}
    }, timeoutMs);

    const stdinWriter =
      proc.stdin && typeof proc.stdin !== "number"
        ? (proc.stdin as { write: (s: string) => unknown; end?: () => unknown })
        : null;

    const result: Promise<RunResult> = (async () => {
      let output = "";
      let status: RunResult["status"] = "completed";
      let errorMsg = "";
      let sessionId = "";
      let streamingCurrentTurn = false;

      if (!stdinWriter) {
        clearTimeout(timeoutHandle);
        return failedResult("hermes stdin pipe unavailable", startedAt);
      }

      const promptDone = new AsyncQueue<PromptResult>();
      const client = new ACPClient({
        logger,
        write: (data) => {
          try {
            stdinWriter.write(data);
          } catch (e) {
            logger.warn(`hermes stdin write failed: ${(e as Error).message}`);
          }
        },
        acceptNotification: () => streamingCurrentTurn,
        onMessage: (m) => {
          if (!streamingCurrentTurn) return;
          if (m.type === "text" && m.content) output += m.content;
          messages.push(m);
        },
        onPromptDone: (pr) => {
          if (!streamingCurrentTurn) return;
          promptDone.push(pr);
        },
      });

      const stdout = proc.stdout as ReadableStream<Uint8Array> | null;
      const readerDone = (async () => {
        if (!stdout) return;
        try {
          for await (const line of readLines(stdout, 10 * 1024 * 1024)) {
            const t = line.trim();
            if (t) client.handleLine(t);
          }
        } finally {
          client.closeAllPending(new Error("hermes process exited"));
        }
      })();

      try {
        // 1) initialize
        await client.request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: "agora-agent-sdk", version: "0.2.0" },
          clientCapabilities: {},
        });

        // 2) session/new or session/resume
        const cwd = opts.cwd || ".";
        if (opts.resumeSessionId) {
          const r = await client.request("session/resume", {
            cwd,
            sessionId: opts.resumeSessionId,
          });
          const got = extractSessionId(r);
          sessionId = got || opts.resumeSessionId;
          if (got && got !== opts.resumeSessionId) {
            logger.warn(
              `hermes resume returned different session id requested=${opts.resumeSessionId} actual=${got}`,
            );
          }
        } else {
          const params: Record<string, unknown> = { cwd, mcpServers: [] };
          if (opts.model) params.model = opts.model;
          const r = await client.request("session/new", params);
          sessionId = extractSessionId(r);
          if (!sessionId) throw new Error("hermes session/new returned no session ID");
        }
        client.sessionId = sessionId;
        logger.info(`hermes session created session_id=${sessionId}`);

        // 3) session/set_model (only when explicit model picked)
        if (opts.model) {
          try {
            await client.request("session/set_model", {
              sessionId,
              modelId: opts.model,
            });
            logger.info(`hermes session model set model=${opts.model}`);
          } catch (e) {
            const msg = `hermes could not switch to model ${opts.model}: ${(e as Error).message}`;
            logger.warn(msg);
            throw new Error(msg);
          }
        }

        // 4) session/prompt with optional system-prompt prefix
        const userText = opts.systemPrompt
          ? `${opts.systemPrompt}\n\n---\n\n${prompt}`
          : prompt;
        streamingCurrentTurn = true;
        try {
          await client.request("session/prompt", {
            sessionId,
            prompt: [{ type: "text", text: userText }],
          });
          // Drain optional PromptResponse usage if surfaced.
          const pr = await raceFirst(promptDone, 10);
          if (pr) {
            if (pr.stopReason === "cancelled") {
              status = "aborted";
              errorMsg = "hermes cancelled the prompt";
            }
            client.mergeUsage(pr.usage);
          }
        } catch (e) {
          status = "failed";
          errorMsg = `hermes session/prompt failed: ${(e as Error).message}`;
        }
      } catch (e) {
        if (status === "completed") {
          status = "failed";
          errorMsg = (e as Error).message;
        }
      }

      // Shutdown.
      try {
        stdinWriter.end?.();
      } catch {}
      try {
        proc.kill("SIGTERM");
      } catch {}
      const exitCode = await proc.exited;
      await readerDone;
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startedAt;

      if (cancelled) {
        status = "cancelled";
        errorMsg = "execution cancelled";
      } else if (timedOut && status === "completed") {
        status = "timeout";
        errorMsg = `hermes timed out after ${timeoutMs}ms`;
      } else if (exitCode !== 0 && status === "completed") {
        status = "failed";
        errorMsg = `hermes exited with code ${exitCode}`;
      }
      // Provider error sniffed from stderr promotes empty-output runs.
      if (status === "completed" && output === "") {
        const sniffed = sniffer.message();
        if (sniffed) {
          status = "failed";
          errorMsg = sniffed;
        }
      }
      if (errorMsg) {
        errorMsg = withAgentStderr(errorMsg, "hermes", stderrTail?.tail() ?? "");
      }

      // Usage map.
      const usage = client.getUsage();
      const usageByModel: Record<string, TokenUsage> = {};
      if (
        usage.inputTokens > 0 ||
        usage.outputTokens > 0 ||
        usage.cacheReadTokens > 0 ||
        usage.cacheWriteTokens > 0
      ) {
        usageByModel[opts.model || "unknown"] = usage;
      }

      logger.info(`hermes finished pid=${proc.pid} status=${status} duration=${durationMs}ms`);
      messages.close();
      return {
        status,
        output,
        error: errorMsg || undefined,
        durationMs,
        sessionId: sessionId || undefined,
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

// ── ACP JSON-RPC client ──

interface ACPClientOpts {
  logger: Logger;
  write: (data: string) => void;
  acceptNotification: (updateType: string) => boolean;
  onMessage: (m: Message) => void;
  onPromptDone: (pr: PromptResult) => void;
}

class ACPClient {
  sessionId = "";
  private nextId = 0;
  private readonly pending = new Map<number, PendingRpc>();
  private readonly tools = new Map<string, PendingToolCall>();
  private usage: TokenUsage = blankUsage();

  constructor(private readonly opts: ACPClientOpts) {}

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.nextId += 1;
    const id = this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.opts.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  closeAllPending(err: Error): void {
    for (const [id, pr] of this.pending.entries()) {
      pr.reject(err);
      this.pending.delete(id);
    }
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  mergeUsage(u: TokenUsage): void {
    if (u.inputTokens > this.usage.inputTokens) this.usage.inputTokens = u.inputTokens;
    if (u.outputTokens > this.usage.outputTokens) this.usage.outputTokens = u.outputTokens;
    if (u.cacheReadTokens > this.usage.cacheReadTokens) {
      this.usage.cacheReadTokens = u.cacheReadTokens;
    }
  }

  handleLine(line: string): void {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const hasId = "id" in raw;
    if (hasId && ("result" in raw || "error" in raw)) {
      this.handleResponse(raw);
      return;
    }
    if (hasId && "method" in raw) {
      this.handleAgentRequest(raw);
      return;
    }
    if ("method" in raw) this.handleNotification(raw);
  }

  private handleResponse(raw: Record<string, unknown>): void {
    const id = numericId(raw.id);
    if (id === null) return;
    const pr = this.pending.get(id);
    if (!pr) return;
    this.pending.delete(id);
    if (raw.error) {
      const e = raw.error as { code?: number; message?: string };
      pr.reject(new Error(`${pr.method}: ${e.message ?? "rpc error"} (code=${e.code ?? -1})`));
      return;
    }
    if (pr.method === "session/prompt") {
      this.extractPromptResult(raw.result);
    }
    pr.resolve(raw.result);
  }

  private handleAgentRequest(raw: Record<string, unknown>): void {
    const method = typeof raw.method === "string" ? raw.method : "";
    const id = raw.id;
    if (method === "session/request_permission") {
      const resp = {
        jsonrpc: "2.0",
        id,
        result: {
          outcome: { outcome: "selected", optionId: "approve_for_session" },
        },
      };
      this.opts.write(`${JSON.stringify(resp)}\n`);
      this.opts.logger.debug(`auto-approved agent permission request method=${method}`);
      return;
    }
    const err = {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `method not found: ${method}` },
    };
    this.opts.write(`${JSON.stringify(err)}\n`);
    this.opts.logger.debug(`unhandled agent→client request method=${method}`);
  }

  private handleNotification(raw: Record<string, unknown>): void {
    const method = typeof raw.method === "string" ? raw.method : "";
    if (method !== "session/update" && method !== "session/notification") return;
    const params = (raw.params ?? {}) as { sessionId?: string; update?: unknown };
    const updateRaw = params.update;
    if (!updateRaw || typeof updateRaw !== "object") return;
    const { type: updateType, data } = normalizeAcpUpdate(updateRaw as Record<string, unknown>);
    if (!this.opts.acceptNotification(updateType)) return;

    switch (updateType) {
      case "agent_message_chunk":
        this.handleAgentMessage(data);
        break;
      case "agent_thought_chunk":
        this.handleAgentThought(data);
        break;
      case "tool_call":
        this.handleToolCallStart(data);
        break;
      case "tool_call_update":
        this.handleToolCallUpdate(data);
        break;
      case "usage_update":
        this.handleUsageUpdate(data);
        break;
      case "turn_end":
        this.extractPromptResult(data);
        break;
    }
  }

  private extractPromptResult(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const r = data as {
      stopReason?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        thoughtTokens?: number;
        cachedReadTokens?: number;
      };
    };
    const usage: TokenUsage = blankUsage();
    if (r.usage) {
      usage.inputTokens = r.usage.inputTokens ?? 0;
      usage.outputTokens = r.usage.outputTokens ?? 0;
      usage.cacheReadTokens = r.usage.cachedReadTokens ?? 0;
    }
    this.opts.onPromptDone({ stopReason: r.stopReason ?? "", usage });
  }

  private handleAgentMessage(data: Record<string, unknown>): void {
    const text = textOfContent(data);
    if (text) this.opts.onMessage({ type: "text", content: text });
  }

  private handleAgentThought(data: Record<string, unknown>): void {
    const text = textOfContent(data);
    if (text) this.opts.onMessage({ type: "thinking", content: text });
  }

  private handleToolCallStart(data: Record<string, unknown>): void {
    const callId = typeof data.toolCallId === "string" ? data.toolCallId : "";
    const title = typeof data.title === "string" ? data.title : "";
    const kind = typeof data.kind === "string" ? data.kind : "";
    const name = typeof data.name === "string" ? data.name : "";
    const rawInput = pickObject(data, "rawInput", "input", "parameters");
    let toolName = hermesToolNameFromTitle(title, kind);
    if (!toolName) toolName = name;

    if (rawInput) {
      this.tools.set(callId, { toolName, input: rawInput, argsText: "", emitted: true });
      this.opts.onMessage({
        type: "tool-use",
        tool: toolName,
        callId,
        input: rawInput,
      });
      return;
    }

    // Streamed args (kimi-style); buffer.
    const blocks = Array.isArray(data.content) ? (data.content as unknown[]) : [];
    this.tools.set(callId, {
      toolName,
      input: null,
      argsText: extractAcpToolCallText(blocks),
      emitted: false,
    });
  }

  private handleToolCallUpdate(data: Record<string, unknown>): void {
    const callId = typeof data.toolCallId === "string" ? data.toolCallId : "";
    const status = typeof data.status === "string" ? data.status : "";
    const rawInput = pickObject(data, "rawInput", "input", "parameters");
    const title = typeof data.title === "string" ? data.title : (typeof data.name === "string" ? data.name : "");
    const kind = typeof data.kind === "string" ? data.kind : "";
    const blocks = Array.isArray(data.content) ? (data.content as unknown[]) : [];

    if (status !== "completed" && status !== "failed") {
      const pending = this.tools.get(callId);
      if (pending && !pending.emitted) {
        const text = extractAcpToolCallText(blocks);
        if (text) pending.argsText = text;
      }
      return;
    }

    // Completion: emit deferred MessageToolUse first, then the result.
    const pending = this.tools.get(callId) ?? null;
    if (pending) this.tools.delete(callId);
    if (!pending || !pending.emitted) {
      let toolName: string;
      let input: Record<string, unknown> | null;
      if (pending && pending.input) {
        toolName = pending.toolName;
        input = pending.input;
      } else if (pending) {
        toolName = pending.toolName;
        input = parseToolArgsJson(pending.argsText);
      } else {
        toolName = hermesToolNameFromTitle(title, kind);
        input = rawInput;
      }
      this.opts.onMessage({
        type: "tool-use",
        tool: toolName,
        callId,
        input: input ?? undefined,
      });
    }

    const rawOutput =
      (typeof data.rawOutput === "string" && data.rawOutput) ||
      (typeof data.output === "string" && (data.output as string)) ||
      extractAcpToolCallText(blocks);
    this.opts.onMessage({
      type: "tool-result",
      callId,
      output: rawOutput,
    });
  }

  private handleUsageUpdate(data: Record<string, unknown>): void {
    const u = data.usage as
      | {
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
          cachedReadTokens?: number;
        }
      | undefined;
    if (!u) return;
    if ((u.inputTokens ?? 0) > this.usage.inputTokens) this.usage.inputTokens = u.inputTokens ?? 0;
    if ((u.outputTokens ?? 0) > this.usage.outputTokens) {
      this.usage.outputTokens = u.outputTokens ?? 0;
    }
    if ((u.cachedReadTokens ?? 0) > this.usage.cacheReadTokens) {
      this.usage.cacheReadTokens = u.cachedReadTokens ?? 0;
    }
  }
}

// ── Helpers ──

function blankUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
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

function extractSessionId(r: unknown): string {
  if (!r || typeof r !== "object") return "";
  const sid = (r as { sessionId?: unknown }).sessionId;
  return typeof sid === "string" ? sid : "";
}

function numericId(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickObject(
  data: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> | null {
  for (const k of keys) {
    const v = data[k];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return null;
}

function textOfContent(data: Record<string, unknown>): string {
  const c = data.content as { type?: string; text?: string } | undefined;
  if (!c || typeof c !== "object") return "";
  if (c.type !== "text") return "";
  return typeof c.text === "string" ? c.text : "";
}

function normalizeAcpUpdate(
  data: Record<string, unknown>,
): { type: string; data: Record<string, unknown> } {
  const su = typeof data.sessionUpdate === "string" ? data.sessionUpdate : "";
  const t = typeof data.type === "string" ? data.type : "";
  if (su) return { type: normalizeAcpUpdateType(su), data };
  if (t) return { type: normalizeAcpUpdateType(t), data };
  // Externally tagged single-key wrapper: {agentMessageChunk: {...}}
  const keys = Object.keys(data);
  if (keys.length === 1) {
    const k = keys[0]!;
    const v = data[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return { type: normalizeAcpUpdateType(k), data: v as Record<string, unknown> };
    }
  }
  return { type: "", data };
}

function normalizeAcpUpdateType(t: string): string {
  const key = t.trim().replace(/[_-]/g, "").toLowerCase();
  switch (key) {
    case "agentmessagechunk":
      return "agent_message_chunk";
    case "agentthoughtchunk":
      return "agent_thought_chunk";
    case "toolcall":
      return "tool_call";
    case "toolcallupdate":
      return "tool_call_update";
    case "usageupdate":
      return "usage_update";
    case "turnend":
    case "endturn":
      return "turn_end";
    default:
      return "";
  }
}

function extractAcpToolCallText(blocks: unknown[]): string {
  const out: string[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "";
    if (type === "content") {
      const inner = block.content as { type?: string; text?: string } | undefined;
      if (inner && inner.type === "text" && typeof inner.text === "string" && inner.text) {
        out.push(inner.text);
      }
    } else if (type === "diff") {
      const path = typeof block.path === "string" ? block.path : "";
      const oldText = typeof block.oldText === "string" ? (block.oldText as string) : "";
      const newText = typeof block.newText === "string" ? (block.newText as string) : "";
      if (!path) continue;
      if (oldText === "") {
        out.push(`--- ${path}\n+++ ${path}\n(new file, ${newText.length} bytes)`);
      } else {
        out.push(`--- ${path}\n+++ ${path}\n(edited: ${oldText.length} → ${newText.length} bytes)`);
      }
    }
  }
  return out.join("\n");
}

function parseToolArgsJson(argsText: string): Record<string, unknown> | null {
  const t = argsText.trim();
  if (!t) return null;
  try {
    const v = JSON.parse(t);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  return { text: t };
}

export function hermesToolNameFromTitle(title: string, kind: string): string {
  // Exact match (no colon).
  if (title === "execute code") return "execute_code";
  const idx = title.indexOf(":");
  if (idx > 0) {
    const name = title.slice(0, idx).trim();
    if (name === "terminal") return "terminal";
    if (name === "read") return "read_file";
    if (name === "write") return "write_file";
    if (name.startsWith("patch")) return "patch";
    if (name === "search") return "search_files";
    if (name === "web search") return "web_search";
    if (name === "extract") return "web_extract";
    if (name === "delegate") return "delegate_task";
    if (name === "analyze image") return "vision_analyze";
    return name;
  }
  switch (kind) {
    case "read":
      return "read_file";
    case "edit":
      return "write_file";
    case "execute":
      return "terminal";
    case "search":
      return "search_files";
    case "fetch":
      return "web_search";
    case "think":
      return "thinking";
    default:
      return title || kind;
  }
}

// ── Provider-error sniffer ──

const ACP_HEADER_RE =
  /(?:⚠️|❌|\[ERROR\]).*(?:BadRequestError|AuthenticationError|RateLimitError|HTTP [0-9]{3}|Non-retryable|API call failed)/;
const ACP_DETAIL_RE = /(?:Error:|detail:|Details:)\s*(.+)/;
const ACP_MAX_LINES = 8;

export class ACPProviderErrorSniffer {
  private remains = "";
  private readonly lines: string[] = [];
  private readonly seen = new Set<string>();
  constructor(private readonly provider: string) {}

  write(chunk: string): void {
    const data = this.remains + chunk;
    const nl = data.lastIndexOf("\n");
    if (nl < 0) {
      this.remains = data;
      return;
    }
    const complete = data.slice(0, nl);
    this.remains = data.slice(nl + 1);
    for (const raw of complete.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (!ACP_HEADER_RE.test(line) && !ACP_DETAIL_RE.test(line)) continue;
      if (this.seen.has(line)) continue;
      this.seen.add(line);
      this.lines.push(line);
      if (this.lines.length > ACP_MAX_LINES) this.lines.shift();
    }
  }

  message(): string {
    const prefix = `${this.provider} provider error: `;
    for (const line of this.lines) {
      const m = ACP_DETAIL_RE.exec(line);
      if (m && m[1]) {
        const detail = m[1].trim();
        if (detail) return prefix + detail;
      }
    }
    for (const line of this.lines) {
      if (ACP_HEADER_RE.test(line)) return prefix + line;
    }
    return "";
  }
}

async function pipeStderr(
  stream: ReadableStream<Uint8Array> | null,
  logger: Logger,
  sniffer: ACPProviderErrorSniffer,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value && value.length > 0) {
        const text = decoder.decode(value, { stream: true });
        sniffer.write(text);
        for (const line of text.split("\n")) {
          const t = line.trim();
          if (t) logger.debug(`[hermes:stderr] ${t}`);
        }
      }
      if (done) return;
    }
  } catch {} finally {
    reader.releaseLock();
  }
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

async function raceFirst<T>(q: AsyncQueue<T>, timeoutMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    q[Symbol.asyncIterator]()
      .next()
      .then((r) => {
        clearTimeout(timer);
        if (r.done) resolve(null);
        else resolve(r.value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

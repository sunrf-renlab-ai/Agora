// Codex runner backend.
// Spawns `codex app-server --listen stdio://` and drives a JSON-RPC 2.0
// session over stdin/stdout. Sequence:
//   initialize → notify("initialized") → thread/resume|start → turn/start
//   → wait for turn/completed (or task_complete in legacy mode).
// Auto-approves item/*/requestApproval. Semantic-inactivity timeout
// resets on every observed agent activity. Falls back to scanning Codex
// session JSONL files for usage when the protocol doesn't surface tokens.

import { existsSync, readFileSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

/** Flags blocked from user-supplied customArgs for the Codex backend. */
export const codexBlockedArgs: BlockedArgs = {
  "--listen": "with-value",
};

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_SEMANTIC_INACTIVITY_MS = 10 * 60 * 1000;
const CODEX_STDERR_TAIL_BYTES = 2048;

export function buildCodexArgs(opts: ExecOptions): string[] {
  const args: string[] = ["app-server", "--listen", "stdio://"];
  args.push(...filterCustomArgs(opts.extraArgs ?? [], codexBlockedArgs));
  args.push(...filterCustomArgs(opts.customArgs ?? [], codexBlockedArgs));
  return args;
}

export class CodexBackend implements Backend {
  constructor(private readonly cfg: BackendConfig) {}

  execute(prompt: string, opts: ExecOptions): Session {
    const logger = this.cfg.logger ?? defaultLogger;
    const execPath = this.cfg.executablePath || "codex";
    const args = buildCodexArgs(opts);
    logger.info(`agent command exec=${execPath} args=${JSON.stringify(args)}`);

    const messages = new AsyncQueue<Message>();
    const startedAt = Date.now();
    let cancelled = false;
    let timedOut = false;

    const env = { ...(this.cfg.env ?? {}), ...(opts.customEnv ?? {}) };
    const { proc, stderrTail } = spawn({
      cmd: [execPath, ...args],
      cwd: opts.cwd,
      env,
      onSpawn: opts.onSpawn,
      onExit: opts.onExit,
      stdin: "pipe",
      captureStderrTail: true,
    });
    logger.info(`codex started app-server pid=${proc.pid} cwd=${opts.cwd}`);

    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    const semanticInactivityMs =
      opts.semanticInactivityMs && opts.semanticInactivityMs > 0
        ? opts.semanticInactivityMs
        : DEFAULT_SEMANTIC_INACTIVITY_MS;
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
      let threadId = "";
      let resolvedModel = opts.model ?? "";

      if (!stdinWriter) {
        clearTimeout(timeoutHandle);
        return failedResult("codex stdin pipe unavailable", startedAt);
      }

      const client = new CodexClient({
        logger,
        write: (data) => {
          try {
            stdinWriter.write(data);
          } catch (e) {
            logger.warn(`codex stdin write failed: ${(e as Error).message}`);
          }
        },
        threadIdGetter: () => threadId,
        onMessage: (m) => {
          if (m.type === "text" && m.content) output += m.content;
          messages.push(m);
        },
      });

      // Reader: drain stdout line-by-line and feed the client.
      const stdout = proc.stdout as ReadableStream<Uint8Array> | null;
      const readerDone = (async () => {
        if (!stdout) return;
        try {
          for await (const line of readLines(stdout, 10 * 1024 * 1024)) {
            const t = line.trim();
            if (t) client.handleLine(t);
          }
        } finally {
          client.closeAllPending(new Error("codex process exited"));
        }
      })();

      try {
        // 1) initialize
        await client.request("initialize", {
          clientInfo: {
            name: "agora-agent-sdk",
            title: "Agora Agent SDK",
            version: "0.2.0",
          },
          capabilities: { experimentalApi: true },
        });
        client.notify("initialized");

        // 2) thread/resume or thread/start
        const thread = await startOrResumeThread(client, opts, logger);
        threadId = thread.threadId;
        client.threadId = threadId;
        if (thread.resumed) logger.info(`codex thread resumed id=${threadId}`);
        else logger.info(`codex thread started id=${threadId}`);

        // 3) turn/start
        await client.request("turn/start", {
          threadId,
          input: [{ type: "text", text: prompt }],
        });

        // 4) wait for turn done with semantic inactivity guard
        const outcome = await waitForTurnDone(client, semanticInactivityMs);
        if (outcome.kind === "aborted") {
          status = "aborted";
          errorMsg = "turn was aborted";
        } else if (outcome.kind === "semantic_timeout") {
          status = "timeout";
          errorMsg = `codex semantic inactivity timeout after ${semanticInactivityMs}ms (last activity: ${outcome.lastActivity})`;
          logger.warn(
            `codex semantic inactivity timeout pid=${proc.pid} thread=${threadId} idle_for_ms=${outcome.idleForMs}`,
          );
        } else if (outcome.kind === "completed") {
          const turnErr = client.getTurnError();
          if (turnErr) {
            status = "failed";
            errorMsg = turnErr;
          }
        }
      } catch (e) {
        status = "failed";
        errorMsg = withAgentStderr((e as Error).message, "codex", stderrTail?.tail() ?? "");
      }

      // Shut down: close stdin so codex exits, then drain reader.
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
        errorMsg = `codex timed out after ${timeoutMs}ms`;
      } else if (exitCode !== 0 && status === "completed") {
        status = "failed";
        errorMsg = `codex exited with code ${exitCode}`;
      }
      if (errorMsg) {
        errorMsg = withAgentStderr(errorMsg, "codex", stderrTail?.tail() ?? "");
      }

      // Usage: prefer JSON-RPC notifications; fall back to scanning ~/.codex/sessions JSONL.
      let usage = client.getUsage();
      if (usage.inputTokens === 0 && usage.outputTokens === 0) {
        const scanned = scanCodexSessionUsage(startedAt);
        if (scanned) {
          usage = scanned.usage;
          if (scanned.model && !resolvedModel) resolvedModel = scanned.model;
        }
      }

      const usageByModel: Record<string, TokenUsage> = {};
      if (usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0) {
        usageByModel[resolvedModel || "unknown"] = usage;
      }

      logger.info(`codex finished pid=${proc.pid} status=${status} duration=${durationMs}ms`);
      messages.close();
      return {
        status,
        output,
        error: errorMsg || undefined,
        durationMs,
        sessionId: threadId || undefined,
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

// ── codexClient: JSON-RPC 2.0 transport ──

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  method: string;
}

interface CodexClientOpts {
  logger: Logger;
  write: (data: string) => void;
  threadIdGetter: () => string;
  onMessage: (m: Message) => void;
}

class CodexClient {
  threadId = "";
  turnId = "";
  private nextId = 0;
  private readonly pending = new Map<number, PendingRpc>();
  private notificationProtocol: "unknown" | "legacy" | "raw" = "unknown";
  private turnStarted = false;
  private readonly completedTurnIds = new Set<string>();
  private usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  private turnError = "";

  // Activity / completion signals consumed by waitForTurnDone.
  readonly activity = new AsyncQueue<{ kind: "activity" | "done"; aborted?: boolean; description?: string }>();

  constructor(private readonly opts: CodexClientOpts) {}

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.nextId += 1;
    const id = this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.opts.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      if (method === "turn/start") {
        const threadId = (params as { threadId?: string }).threadId ?? "";
        this.opts.logger.info(`codex turn/start sent request_id=${id} thread_id=${threadId}`);
      }
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    const msg: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) msg.params = params;
    this.opts.write(`${JSON.stringify(msg)}\n`);
  }

  respond(id: number, result: unknown): void {
    this.opts.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  respondError(id: number, code: number, message: string): void {
    this.opts.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
  }

  closeAllPending(err: Error): void {
    for (const [id, pr] of this.pending.entries()) {
      pr.reject(err);
      this.pending.delete(id);
    }
    this.activity.close();
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  getTurnError(): string {
    return this.turnError;
  }

  setTurnError(msg: string): void {
    if (msg && !this.turnError) this.turnError = msg;
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
      this.handleServerRequest(raw);
      return;
    }
    if ("method" in raw) this.handleNotification(raw);
  }

  private handleResponse(raw: Record<string, unknown>): void {
    const id = typeof raw.id === "number" ? raw.id : -1;
    const pr = this.pending.get(id);
    if (!pr) return;
    this.pending.delete(id);
    if (raw.error) {
      const e = raw.error as { code?: number; message?: string };
      pr.reject(new Error(`${pr.method}: ${e.message ?? "rpc error"} (code=${e.code ?? -1})`));
    } else {
      pr.resolve(raw.result);
    }
  }

  private handleServerRequest(raw: Record<string, unknown>): void {
    const id = typeof raw.id === "number" ? raw.id : -1;
    const method = typeof raw.method === "string" ? raw.method : "";
    switch (method) {
      case "item/commandExecution/requestApproval":
      case "execCommandApproval":
        this.respond(id, { decision: "accept" });
        return;
      case "item/fileChange/requestApproval":
      case "applyPatchApproval":
        this.respond(id, { decision: "accept" });
        return;
      case "mcpServer/elicitation/request":
        this.respond(id, { action: "accept", content: null, _meta: null });
        return;
      default:
        this.opts.logger.warn(`codex: unhandled server request method=${method} id=${id}`);
        this.respondError(id, -32601, `unhandled server request: ${method}`);
    }
  }

  private handleNotification(raw: Record<string, unknown>): void {
    const method = typeof raw.method === "string" ? raw.method : "";
    const params = (raw.params ?? {}) as Record<string, unknown>;

    // Legacy codex/event
    if (method === "codex/event" || method.startsWith("codex/event/")) {
      this.notificationProtocol = "legacy";
      const msg = params.msg as Record<string, unknown> | undefined;
      if (msg) this.handleLegacyEvent(msg);
      return;
    }

    // Raw v2
    if (this.notificationProtocol !== "legacy") {
      if (
        this.notificationProtocol === "unknown" &&
        (method === "turn/started" ||
          method === "turn/completed" ||
          method === "thread/started" ||
          method.startsWith("item/"))
      ) {
        this.notificationProtocol = "raw";
      }
      if (this.notificationProtocol === "raw") this.handleRawNotification(method, params);
    }
  }

  private handleLegacyEvent(msg: Record<string, unknown>): void {
    const type = typeof msg.type === "string" ? msg.type : "";
    switch (type) {
      case "task_started":
        this.turnStarted = true;
        this.emitMessage({ type: "status", status: "running", sessionId: this.threadId });
        break;
      case "agent_message": {
        const text = typeof msg.message === "string" ? msg.message : "";
        if (text) this.emitMessage({ type: "text", content: text });
        break;
      }
      case "exec_command_begin":
        this.emitMessage({
          type: "tool-use",
          tool: "exec_command",
          callId: typeof msg.call_id === "string" ? msg.call_id : "",
          input: { command: typeof msg.command === "string" ? msg.command : "" },
        });
        break;
      case "exec_command_end":
        this.emitMessage({
          type: "tool-result",
          tool: "exec_command",
          callId: typeof msg.call_id === "string" ? msg.call_id : "",
          output: typeof msg.output === "string" ? msg.output : "",
        });
        break;
      case "patch_apply_begin":
        this.emitMessage({
          type: "tool-use",
          tool: "patch_apply",
          callId: typeof msg.call_id === "string" ? msg.call_id : "",
        });
        break;
      case "patch_apply_end":
        this.emitMessage({
          type: "tool-result",
          tool: "patch_apply",
          callId: typeof msg.call_id === "string" ? msg.call_id : "",
        });
        break;
      case "task_complete":
        this.extractUsageFromMap(msg);
        this.activity.push({ kind: "done", aborted: false });
        break;
      case "turn_aborted":
        this.activity.push({ kind: "done", aborted: true });
        break;
    }
  }

  private handleRawNotification(method: string, params: Record<string, unknown>): void {
    const threadId = typeof params.threadId === "string" ? params.threadId : "";
    if (this.threadId && threadId && threadId !== this.threadId) return;

    switch (method) {
      case "turn/started": {
        this.turnStarted = true;
        const turnId = extractNestedString(params, "turn", "id");
        if (turnId) this.turnId = turnId;
        this.emitMessage({ type: "status", status: "running", sessionId: this.threadId });
        break;
      }
      case "turn/completed": {
        const turnId = extractNestedString(params, "turn", "id");
        const status = extractNestedString(params, "turn", "status");
        this.opts.logger.info(
          `codex turn/completed thread_id=${threadId} turn_id=${turnId} status=${status}`,
        );
        const aborted =
          status === "cancelled" || status === "canceled" || status === "aborted" || status === "interrupted";
        if (status === "failed") {
          const errMsg = extractNestedString(params, "turn", "error", "message") || "codex turn failed";
          this.setTurnError(errMsg);
        }
        if (turnId) {
          if (this.completedTurnIds.has(turnId)) return;
          this.completedTurnIds.add(turnId);
        }
        const turn = params.turn as Record<string, unknown> | undefined;
        if (turn) this.extractUsageFromMap(turn);
        this.activity.push({ kind: "done", aborted });
        break;
      }
      case "error": {
        const willRetry = params.willRetry === true;
        const errMsg =
          extractNestedString(params, "error", "message") || extractNestedString(params, "message");
        if (errMsg) {
          this.opts.logger.warn(`codex error notification message="${errMsg}" will_retry=${willRetry}`);
          if (!willRetry) this.setTurnError(errMsg);
        }
        break;
      }
      case "thread/status/changed": {
        const statusType = extractNestedString(params, "status", "type");
        if (statusType === "idle" && this.turnStarted) {
          this.activity.push({ kind: "done", aborted: false });
        }
        break;
      }
      default:
        if (method.startsWith("item/")) this.handleItemNotification(method, params);
    }
  }

  private handleItemNotification(method: string, params: Record<string, unknown>): void {
    const item = params.item as Record<string, unknown> | undefined;
    const itemType = typeof item?.type === "string" ? (item.type as string) : "";
    const itemId = typeof item?.id === "string" ? (item.id as string) : "";
    if (isProgressActivity(method)) {
      this.activity.push({
        kind: "activity",
        description: `${method}:${itemType || "unknown"}${itemId ? `:${itemId}` : ""}`,
      });
    }
    if (!item) return;

    if (method === "item/started" && itemType === "commandExecution") {
      this.emitMessage({
        type: "tool-use",
        tool: "exec_command",
        callId: itemId,
        input: { command: typeof item.command === "string" ? (item.command as string) : "" },
      });
    } else if (method === "item/completed" && itemType === "commandExecution") {
      this.emitMessage({
        type: "tool-result",
        tool: "exec_command",
        callId: itemId,
        output: typeof item.aggregatedOutput === "string" ? (item.aggregatedOutput as string) : "",
      });
    } else if (method === "item/started" && itemType === "fileChange") {
      this.emitMessage({ type: "tool-use", tool: "patch_apply", callId: itemId });
    } else if (method === "item/completed" && itemType === "fileChange") {
      this.emitMessage({ type: "tool-result", tool: "patch_apply", callId: itemId });
    } else if (method === "item/completed" && itemType === "agentMessage") {
      const text = typeof item.text === "string" ? (item.text as string) : "";
      if (text) this.emitMessage({ type: "text", content: text });
      if (item.phase === "final_answer" && this.turnStarted) {
        this.activity.push({ kind: "done", aborted: false });
      }
    }
  }

  private emitMessage(m: Message): void {
    this.opts.onMessage(m);
    this.activity.push({
      kind: "activity",
      description: describeSemantic(m),
    });
  }

  private extractUsageFromMap(data: Record<string, unknown>): void {
    let u: Record<string, unknown> | null = null;
    for (const k of ["usage", "token_usage", "tokens"]) {
      const v = data[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        u = v as Record<string, unknown>;
        break;
      }
    }
    if (!u) return;
    this.usage.inputTokens += pickNumber(u, "input_tokens", "input", "prompt_tokens");
    this.usage.outputTokens += pickNumber(u, "output_tokens", "output", "completion_tokens");
    this.usage.cacheReadTokens += pickNumber(u, "cache_read_tokens", "cache_read_input_tokens");
    this.usage.cacheWriteTokens += pickNumber(u, "cache_write_tokens", "cache_creation_input_tokens");
  }
}

async function startOrResumeThread(
  client: CodexClient,
  opts: ExecOptions,
  logger: Logger,
): Promise<{ threadId: string; resumed: boolean }> {
  if (opts.resumeSessionId) {
    try {
      const r = await client.request("thread/resume", {
        threadId: opts.resumeSessionId,
        cwd: opts.cwd,
        model: nilIfEmpty(opts.model),
        developerInstructions: nilIfEmpty(opts.systemPrompt),
      });
      const tid = extractThreadId(r);
      if (tid) return { threadId: tid, resumed: true };
      logger.warn(
        `codex thread/resume returned no thread id; falling back to thread/start prior=${opts.resumeSessionId}`,
      );
    } catch (e) {
      logger.warn(
        `codex thread/resume failed; falling back to thread/start prior=${opts.resumeSessionId} err=${(e as Error).message}`,
      );
    }
  }
  const r = await client.request("thread/start", {
    model: nilIfEmpty(opts.model),
    modelProvider: null,
    profile: null,
    cwd: opts.cwd,
    approvalPolicy: null,
    sandbox: null,
    config: null,
    baseInstructions: null,
    developerInstructions: nilIfEmpty(opts.systemPrompt),
    compactPrompt: null,
    includeApplyPatchTool: null,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  });
  const tid = extractThreadId(r);
  if (!tid) throw new Error("codex thread/start returned no thread ID");
  return { threadId: tid, resumed: false };
}

async function waitForTurnDone(
  client: CodexClient,
  semanticInactivityMs: number,
): Promise<
  | { kind: "completed" }
  | { kind: "aborted" }
  | { kind: "semantic_timeout"; lastActivity: string; idleForMs: number }
> {
  let lastActivity = "turn/start";
  let lastActivityAt = Date.now();
  const iter = client.activity[Symbol.asyncIterator]();

  while (true) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const next = await new Promise<
      | { kind: "activity"; description: string }
      | { kind: "done"; aborted: boolean }
      | { kind: "stream_closed" }
      | { kind: "semantic_timeout" }
    >((resolve) => {
      timer = setTimeout(() => resolve({ kind: "semantic_timeout" }), semanticInactivityMs);
      iter
        .next()
        .then((r) => {
          if (r.done) {
            resolve({ kind: "stream_closed" });
            return;
          }
          if (r.value.kind === "done") {
            resolve({ kind: "done", aborted: !!r.value.aborted });
          } else {
            resolve({ kind: "activity", description: r.value.description ?? lastActivity });
          }
        })
        .catch(() => resolve({ kind: "stream_closed" }));
    });
    if (timer) clearTimeout(timer);

    if (next.kind === "semantic_timeout") {
      return {
        kind: "semantic_timeout",
        lastActivity,
        idleForMs: Date.now() - lastActivityAt,
      };
    }
    if (next.kind === "stream_closed") return { kind: "completed" };
    if (next.kind === "done") {
      return next.aborted ? { kind: "aborted" } : { kind: "completed" };
    }
    lastActivity = next.description;
    lastActivityAt = Date.now();
  }
}

// ── Helpers ──

function describeSemantic(m: Message): string {
  if (m.type === "tool-use" || m.type === "tool-result") {
    if (m.tool) return `${m.type}:${m.tool}`;
  }
  if (m.type === "status" && m.status) return `status:${m.status}`;
  return m.type;
}

function isProgressActivity(method: string): boolean {
  switch (method) {
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/mcpToolCall/progress":
      return true;
    default:
      return false;
  }
}

function pickNumber(m: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = m[k];
    if (typeof v === "number" && Number.isFinite(v) && v !== 0) return Math.trunc(v);
  }
  return 0;
}

function extractThreadId(r: unknown): string {
  if (!r || typeof r !== "object") return "";
  const t = (r as { thread?: { id?: unknown } }).thread;
  if (t && typeof t.id === "string") return t.id;
  return "";
}

function extractNestedString(m: Record<string, unknown>, ...keys: string[]): string {
  let cur: unknown = m;
  for (const k of keys) {
    if (!cur || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "string" ? cur : "";
}

function nilIfEmpty(s: string | null | undefined): unknown {
  if (!s) return null;
  return s;
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

// ── Codex session log scanner (~/.codex/sessions/YYYY/MM/DD/*.jsonl) ──

interface ScannedUsage {
  usage: TokenUsage;
  model: string;
}

function codexSessionRoot(): string | null {
  const codexHome = process.env.CODEX_HOME;
  if (codexHome) {
    const dir = join(codexHome, "sessions");
    try {
      if (statSync(dir).isDirectory()) return dir;
    } catch {}
  }
  try {
    const dir = join(homedir(), ".codex", "sessions");
    if (statSync(dir).isDirectory()) return dir;
  } catch {}
  return null;
}

function scanCodexSessionUsage(startedAtMs: number): ScannedUsage | null {
  const root = codexSessionRoot();
  if (!root) return null;
  const d = new Date(startedAtMs);
  const dateDir = join(
    root,
    d.getFullYear().toString().padStart(4, "0"),
    (d.getMonth() + 1).toString().padStart(2, "0"),
    d.getDate().toString().padStart(2, "0"),
  );
  if (!existsSync(dateDir)) return null;
  let files: string[] = [];
  try {
    files = readdirSync(dateDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  let last: ScannedUsage | null = null;
  for (const f of files) {
    const path = join(dateDir, f);
    try {
      const info = statSync(path);
      if (info.mtimeMs < startedAtMs) continue;
      const u = parseCodexSessionFile(path);
      if (u) last = u;
    } catch {}
  }
  if (!last) return null;
  if (last.usage.inputTokens === 0 && last.usage.outputTokens === 0) return null;
  return last;
}

function parseCodexSessionFile(path: string): ScannedUsage | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split(/\r?\n/);
  let model = "";
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let found = false;
  for (const line of lines) {
    if (!line) continue;
    if (!line.includes("token_count") && !line.includes("turn_context")) continue;
    let evt: {
      type?: string;
      payload?: {
        type?: string;
        info?: {
          total_token_usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cached_input_tokens?: number;
            cache_read_input_tokens?: number;
            reasoning_output_tokens?: number;
          };
          last_token_usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cached_input_tokens?: number;
            cache_read_input_tokens?: number;
            reasoning_output_tokens?: number;
          };
          model?: string;
        };
        model?: string;
      };
    };
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = evt.payload;
    if (!payload) continue;
    if (evt.type === "turn_context" && payload.model) {
      model = payload.model;
      continue;
    }
    if (payload.type === "token_count" && payload.info) {
      const tu = payload.info.total_token_usage ?? payload.info.last_token_usage;
      if (tu) {
        const cached = tu.cached_input_tokens ?? tu.cache_read_input_tokens ?? 0;
        usage = {
          inputTokens: tu.input_tokens ?? 0,
          outputTokens: (tu.output_tokens ?? 0) + (tu.reasoning_output_tokens ?? 0),
          cacheReadTokens: cached,
          cacheWriteTokens: 0,
        };
        if (payload.info.model) model = payload.info.model;
        found = true;
      }
    }
  }
  if (!found) return null;
  return { usage, model };
}


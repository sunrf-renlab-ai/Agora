"use client";
import { useTaskMessages } from "@/hooks/useTasks";
import type { TaskMessage } from "@agora/shared";
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useMessage,
} from "@assistant-ui/react";
import { AlertCircle, ArrowUp, Square, Wrench } from "lucide-react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatTrace } from "./AgoraThreadRuntime";

/**
 * Agora chat thread, visually modeled on Gemini's web app:
 * - Centered, ~720px max width column
 * - Empty state: oversized soft-gradient greeting + small example chips
 * - User messages: right-aligned, neutral gray pill (no aggressive
 *   indigo)
 * - Assistant messages: left-aligned, no card/border — just well-set
 *   prose so the text feels like a document, not a bubble
 * - Composer: pill-shaped at the bottom, focus-glow, send button is a
 *   circular indigo affordance
 *
 * The headless primitives still come from `@assistant-ui/react`; we
 * just restyle the slots.
 */
export function AgoraThread() {
  // Gate the empty-state greeting on the messages query having resolved.
  // Opening an existing conversation momentarily has `messages === []`
  // while the fetch is in flight; without this the welcome screen flashes
  // before the thread renders.
  const { messagesReady } = useChatTrace();
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full bg-canvas">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-6 pt-12 pb-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-7">
          {messagesReady && (
            <ThreadPrimitive.Empty>
              <EmptyState />
            </ThreadPrimitive.Empty>
          )}
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          <ThreadPrimitive.If running>
            <TaskTrace />
          </ThreadPrimitive.If>
        </div>
      </ThreadPrimitive.Viewport>

      <div className="bg-gradient-to-t from-canvas via-canvas to-transparent pt-3 pb-5">
        <div className="max-w-2xl mx-auto px-6">
          <Composer />
          <p className="mt-2 text-center text-[11px] text-gray-400">
            ⌘+Enter to send · the agent confirms its plan before filing issues
          </p>
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
}

function EmptyState() {
  const suggestions = [
    "明天北京天气怎么样?",
    "帮我把首页登录加 SSO,要邮箱 + Google + GitHub 三种",
    "扫一下 server/ 下还有哪些 TODO,列个清单",
  ];
  return (
    <div className="py-20 flex flex-col items-center text-center">
      <h1
        className="font-display text-[44px] leading-tight tracking-tight bg-clip-text text-transparent
                   bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500"
      >
        How can I help?
      </h1>
      <p className="mt-2 text-[14px] text-gray-500 leading-relaxed max-w-md">
        Tell me what you want done. I'll draft a plan with subtasks and owners, confirm with you,
        then file the issues so the team can pick them up.
      </p>
      <div className="mt-10 flex flex-col gap-2 w-full max-w-md">
        {suggestions.map((s) => (
          <SuggestionChip key={s} text={s} />
        ))}
      </div>
    </div>
  );
}

function SuggestionChip({ text }: { text: string }) {
  // Clicking a chip pastes the text into the composer. Composer is a
  // sibling DOM element rendered by assistant-ui — we set value via
  // the native setter so React's controlled-input flow stays intact.
  function handleClick() {
    if (typeof document === "undefined") return;
    const composer = document.querySelector<HTMLTextAreaElement>("textarea[data-agora-composer]");
    if (!composer) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    nativeSetter?.call(composer, text);
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    composer.focus();
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-left text-[13.5px] text-gray-700 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-2xl px-4 py-3 transition-colors leading-snug shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
    >
      {text}
    </button>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="bg-gray-100 text-gray-900 rounded-3xl px-4 py-2.5 text-[14px] max-w-[80%] whitespace-pre-wrap leading-relaxed">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const meta = useMessage((m) => m.metadata?.custom as MessageMeta | undefined);
  const failed = !!meta?.failureReason;

  if (failed) {
    return (
      <MessagePrimitive.Root className="flex justify-start">
        <div className="flex items-start gap-2 max-w-[90%] text-red-700 bg-red-50/70 border border-red-100 rounded-md px-3.5 py-2.5">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-[13px] mb-0.5">Failed</p>
            <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{meta?.failureReason}</p>
          </div>
        </div>
      </MessagePrimitive.Root>
    );
  }

  // No avatar, no card — just typeset prose, Gemini-style. The wrapper
  // gets `max-w-[90%]` so long markdown tables still wrap inside the
  // column without bleeding into the user bubble's lane.
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="max-w-[90%] text-[14px] text-gray-900 leading-[1.7]">
        <div className="prose prose-sm prose-gray max-w-none prose-headings:font-semibold prose-headings:text-gray-900 prose-p:my-2 prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:rounded-md prose-pre:text-[12.5px] prose-code:text-[12.5px] prose-code:bg-gray-100 prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none prose-a:text-indigo-700 prose-a:no-underline hover:prose-a:underline prose-img:hidden">
          <MessagePrimitive.Parts components={{ Text: TextPart }} />
        </div>
        {meta?.elapsedMs != null && (
          <p className="mt-1.5 text-[10.5px] text-gray-400 tabular-nums font-mono">
            {(meta.elapsedMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>
    </MessagePrimitive.Root>
  );
}

/**
 * Live trace of the agent's in-flight task. Subscribes (via useTaskMessages)
 * to `task.messages_appended` WS pushes for the currently-running task and
 * renders each tool_use as a one-liner — `Bash: ls -la`, `Read: src/foo.ts`,
 * `Grep: useState` — Claude.ai-style. While tool events haven't arrived yet
 * (initial 1-3s of cold spawn), shows the dot indicator instead.
 */
function TaskTrace() {
  const ctx = useChatTrace();
  const { data: taskMessages = [] } = useTaskMessages(
    ctx.token,
    ctx.workspaceId,
    ctx.activeTaskId,
    ctx.isRunning,
  );

  const traceRows = useMemo(
    () => taskMessages.filter((m) => m.kind === "tool_use" || m.kind === "assistant"),
    [taskMessages],
  );

  if (traceRows.length === 0) return <TypingDots />;

  return (
    <div className="flex justify-start w-full" aria-live="polite">
      <div className="max-w-[90%] space-y-1 text-[12px] text-gray-500">
        {traceRows.map((m) => (
          <TraceRow key={m.id} msg={m} />
        ))}
        <TypingDots compact />
      </div>
    </div>
  );
}

function TraceRow({ msg }: { msg: TaskMessage }) {
  if (msg.kind === "tool_use") {
    const c = msg.content as { tool?: string; name?: string; input?: unknown } | null;
    const name = c?.tool ?? c?.name ?? "tool";
    const summary = summarizeToolInput(name, c?.input);
    return (
      <div className="flex items-center gap-1.5 leading-snug">
        <Wrench className="w-3 h-3 text-gray-400 shrink-0" />
        <span className="font-mono text-gray-700 text-[12px]">{name}</span>
        {summary && (
          <span className="font-mono text-gray-400 truncate text-[12px]" title={summary}>
            {summary}
          </span>
        )}
      </div>
    );
  }
  if (msg.kind === "assistant") {
    const c = msg.content as { text?: string } | null;
    const text = (c?.text ?? "").trim();
    if (text.length === 0) return null;
    return <div className="italic text-gray-500 leading-snug whitespace-pre-wrap">{text}</div>;
  }
  return null;
}

function TypingDots({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-1 pt-0.5" aria-label="Agent is thinking">
        <span className="block w-1 h-1 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.32s]" />
        <span className="block w-1 h-1 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.16s]" />
        <span className="block w-1 h-1 rounded-full bg-gray-400 animate-bounce" />
      </div>
    );
  }
  return (
    <div className="flex justify-start" aria-live="polite" aria-label="Agent is thinking">
      <div className="flex items-center gap-1.5 px-1">
        <span className="block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.32s]" />
        <span className="block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.16s]" />
        <span className="block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
      </div>
    </div>
  );
}

/**
 * One-line, monospaced summary of a tool call's most informative input
 * field. Pattern-matched to Claude Code's built-in tools first, then
 * falls back to the first short string in the input object. Keeps the
 * trace readable — never spills full arguments into the chat surface.
 */
function summarizeToolInput(name: string, input: unknown): string {
  if (input === null || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const pick = (key: string): string | null => {
    const v = i[key];
    return typeof v === "string" ? v : null;
  };
  let raw: string | null = null;
  switch (name) {
    case "Bash":
      raw = pick("command");
      break;
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      raw = pick("file_path");
      break;
    case "Grep":
    case "Glob":
      raw = pick("pattern");
      break;
    case "WebFetch":
      raw = pick("url");
      break;
    case "WebSearch":
      raw = pick("query");
      break;
    case "Agent":
    case "Task":
      raw = pick("description") ?? pick("prompt");
      break;
    default:
      for (const v of Object.values(i)) {
        if (typeof v === "string" && v.length > 0 && v.length < 200) {
          raw = v;
          break;
        }
      }
  }
  if (!raw) return "";
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine;
}

function TextPart({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
      {text}
    </ReactMarkdown>
  );
}

function Composer() {
  // Pill-shaped composer, focus-glow, circular indigo send. Gemini-ish
  // proportions. The textarea carries `data-agora-composer` so empty-
  // state suggestion chips can target it without coupling to a
  // brittle placeholder string.
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2 rounded-3xl border border-gray-200 bg-white pl-5 pr-2.5 py-2.5 shadow-[0_2px_6px_rgba(0,0,0,0.04)] focus-within:border-indigo-300 focus-within:shadow-[0_0_0_4px_oklch(0.93_0.04_255_/_0.7),_0_2px_8px_rgba(0,0,0,0.06)] transition-all">
      <ComposerPrimitive.Input
        autoFocus
        rows={1}
        placeholder="Ask anything…"
        data-agora-composer
        className="flex-1 resize-none border-0 bg-transparent px-0 py-1.5 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-60 max-h-56 leading-relaxed"
      />
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <button
            type="button"
            className="w-9 h-9 inline-flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-colors active:scale-[0.96]"
            aria-label="Stop"
            title="Stop"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <button
            type="submit"
            className="w-9 h-9 inline-flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white rounded-full transition-all active:scale-[0.96] disabled:bg-gray-200 disabled:text-gray-400 disabled:active:scale-100"
            aria-label="Send"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
    </ComposerPrimitive.Root>
  );
}

interface MessageMeta {
  failureReason?: string | null;
  elapsedMs?: number | null;
  taskId?: string | null;
}

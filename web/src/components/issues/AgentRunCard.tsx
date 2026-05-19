"use client";
import type { Agent, AgentTask, TaskMessage, TaskStatus } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCw, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { timeAgo } from "@/components/inbox/InboxListItem";
import { Markdown } from "@/components/ui/Markdown";
import { useToast } from "@/components/ui/Toast";
import { useTaskMessages } from "@/hooks/useTasks";
import { api } from "@/lib/api";

interface AgentRunCardProps {
  task: AgentTask;
  agentsById: Map<string, Agent>;
  token: string | null;
  workspaceId: string | null;
}

const KIND_LABEL: Record<TaskMessage["kind"], string> = {
  stdout: "stdout",
  stderr: "stderr",
  tool_use: "tool",
  tool_result: "result",
  assistant: "agent",
  system: "system",
};

const KIND_BADGE: Record<TaskMessage["kind"], string> = {
  stdout: "bg-gray-100 text-gray-600",
  stderr: "bg-red-50 text-red-700",
  tool_use: "bg-indigo-50 text-indigo-700",
  tool_result: "bg-emerald-50 text-emerald-700",
  assistant: "bg-purple-50 text-purple-700",
  system: "bg-gray-100 text-gray-500",
};

function renderMessageContent(message: TaskMessage): React.ReactNode {
  const content = message.content as Record<string, unknown> | null | undefined;
  if (!content || typeof content !== "object") {
    return (
      <pre className="font-mono text-[11px] whitespace-pre-wrap break-words text-gray-600">
        {JSON.stringify(message.content, null, 2)}
      </pre>
    );
  }
  if (message.kind === "tool_use") {
    const name = typeof content.name === "string" ? content.name : "";
    return (
      <div>
        {name && <div className="font-mono text-[11px] text-indigo-700 mb-0.5">{name}</div>}
        {content.input !== undefined && (
          <pre className="font-mono text-[11px] whitespace-pre-wrap break-words text-gray-600">
            {JSON.stringify(content.input, null, 2)}
          </pre>
        )}
      </div>
    );
  }
  if (message.kind === "tool_result") {
    const name = typeof content.name === "string" ? content.name : "";
    const output = typeof content.output === "string" ? content.output : "";
    return (
      <div>
        {name && <div className="font-mono text-[11px] text-emerald-700 mb-0.5">{name}</div>}
        {output && (
          <pre className="font-mono text-[11px] whitespace-pre-wrap break-words text-gray-700">
            {output}
          </pre>
        )}
      </div>
    );
  }
  const text = typeof content.text === "string" ? content.text : JSON.stringify(content);
  return (
    <pre className="font-mono text-[11px] whitespace-pre-wrap break-words text-gray-700">
      {text}
    </pre>
  );
}

function extractAssistantText(message: TaskMessage): string | null {
  const content = message.content as Record<string, unknown> | null | undefined;
  if (!content || typeof content !== "object") return null;
  if (typeof content.text === "string") return content.text;
  return null;
}

function statusVisual(status: TaskStatus): {
  dotClass: string;
  toneClass: string;
} {
  switch (status) {
    case "running":
    case "dispatched":
      return { dotClass: "bg-amber-500 animate-pulse", toneClass: "text-amber-700" };
    case "completed":
      return { dotClass: "bg-emerald-500", toneClass: "text-emerald-700" };
    case "failed":
      return { dotClass: "bg-red-500", toneClass: "text-red-700" };
    case "cancelled":
      return { dotClass: "bg-gray-400", toneClass: "text-gray-500" };
    default:
      return { dotClass: "bg-gray-400", toneClass: "text-gray-600" };
  }
}

function triggerKey(task: AgentTask): string {
  if (task.parentTaskId) return "rerun";
  if (task.triggerCommentId) return "on_comment";
  if (task.autopilotRunId) return "autopilot";
  if (task.originType === "quick_create") return "quick_create";
  if (task.originType === "autopilot") return "autopilot";
  return "other";
}

export function AgentRunCard({ task, agentsById, token, workspaceId }: AgentRunCardProps) {
  const t = useTranslations("issues.executionLogs");
  const [expanded, setExpanded] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [rerunBusy, setRerunBusy] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const agent = agentsById.get(task.agentId);
  const visual = statusVisual(task.status);
  const tKey = triggerKey(task);
  const triggerLabel = task.triggerSummary?.trim() || t(`triggers.${tKey}`);

  const isRunning = task.status === "running" || task.status === "dispatched";
  const startTs = task.startedAt ?? task.dispatchedAt ?? task.createdAt;
  const finishTs = task.completedAt;

  // Always fetch messages so the inline assistant reply renders without
  // the user clicking "expand". The expand button now controls only the
  // verbose tool-call timeline, which most users don't care about.
  const { data: messages = [], isLoading: messagesLoading } = useTaskMessages(
    token,
    workspaceId,
    task.id,
    true,
  );

  // Pick the latest assistant message to surface inline. We walk
  // backwards because the daemon appends in order and the last one is
  // typically the final answer.
  const latestAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.kind === "assistant") {
        const text = extractAssistantText(m);
        if (text && text.trim().length > 0) return text;
      }
    }
    return null;
  }, [messages]);

  async function handleSendReply() {
    if (!token || !workspaceId || !task.issueId || !agent || replyBusy) return;
    const body = replyText.trim();
    if (!body) return;
    setReplyBusy(true);
    // Prepend an @-mention of the agent so the server's mention parser
    // routes this comment back to the same agent as a fresh task. The
    // agent name is rendered as plain text — the mention path keys off
    // the slug-formatted name; we send the canonical display name so
    // it matches what the picker stores.
    const content = `@${agent.name} ${body}`;
    try {
      await api.createComment(token, workspaceId, task.issueId, content);
      qc.invalidateQueries({ queryKey: ["tasks", workspaceId, task.issueId] });
      qc.invalidateQueries({ queryKey: ["comments", workspaceId, task.issueId] });
      setReplyText("");
      setReplyOpen(false);
    } catch (err) {
      toast(
        `Failed to send reply: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      setReplyBusy(false);
    }
  }

  async function handleRerun() {
    if (!token || !workspaceId || !task.issueId || rerunBusy) return;
    setRerunBusy(true);
    try {
      await api.rerunIssue(token, workspaceId, task.issueId);
      qc.invalidateQueries({ queryKey: ["tasks", workspaceId, task.issueId] });
    } catch (err) {
      toast(
        `Failed to re-run: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      setRerunBusy(false);
    }
  }

  const canInteract = !!token && !!workspaceId && !!task.issueId && !!agent;

  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2.5 flex flex-col gap-2">
      {/* Header — minimal: avatar + name + relative time on
          the right. Status visual collapses to a single dot next to the
          time (or a running pulse) so the chrome doesn't compete with
          the assistant body below. */}
      <div className="flex items-center gap-2.5">
        <div className="h-7 w-7 shrink-0 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-semibold">
          {agent?.name?.[0]?.toUpperCase() ?? "?"}
        </div>
        <span className="text-[13px] font-medium text-gray-800 truncate">
          {agent?.name ?? "Agent"}
        </span>
        <span
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${visual.dotClass}`}
          aria-label={t(`status.${task.status}`)}
          title={t(`status.${task.status}`)}
        />
        <span
          className="ml-auto text-[11px] text-gray-400 tabular-nums shrink-0"
          title={triggerLabel}
        >
          {timeAgo(isRunning ? startTs : (finishTs ?? startTs))}
        </span>
      </div>

      {task.status === "failed" && (task.failureReason || task.error) && (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">
            {t("error.title")}
            {task.failureReason ? ` · ${task.failureReason}` : ""}
          </p>
          {task.error && (
            <p className="text-xs text-red-700 mt-0.5 whitespace-pre-wrap break-words">
              {task.error}
            </p>
          )}
        </div>
      )}

      {/* Inline assistant reply — the body of the card. This is what users
       *  came for: read the agent's answer without clicking through. */}
      {latestAssistant ? (
        <div className="text-sm text-gray-800 leading-relaxed">
          <Markdown source={latestAssistant} />
        </div>
      ) : messagesLoading ? (
        <p className="text-xs text-gray-400 italic">{t("messagesLoading")}</p>
      ) : isRunning ? (
        <p className="text-xs text-gray-400 italic flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("messagesEmptyRunning")}
        </p>
      ) : null}

      {/* Interaction row — reply + re-run. Hidden while running (the
       *  agent is still working; nothing to react to yet). */}
      {canInteract && !isRunning ? (
        <div className="flex items-center gap-1 text-xs text-gray-500 pt-1 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setReplyOpen((v) => !v)}
            className="px-2 py-1 rounded hover:bg-gray-100 hover:text-gray-800"
          >
            {t("replyAffordance")}
          </button>
          <button
            type="button"
            onClick={handleRerun}
            disabled={rerunBusy}
            className="px-2 py-1 rounded hover:bg-gray-100 hover:text-gray-800 inline-flex items-center gap-1 disabled:opacity-50"
          >
            {rerunBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCw className="h-3 w-3" />
            )}
            {t("rerun")}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto px-2 py-1 rounded hover:bg-gray-100"
            aria-expanded={expanded}
          >
            {expanded ? t("collapse") : t("expand")}
          </button>
        </div>
      ) : null}

      {replyOpen && canInteract ? (
        <div className="flex items-end gap-2 pt-1">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSendReply();
              }
            }}
            placeholder={t("replyPlaceholder", { agent: agent?.name ?? "agent" })}
            className="flex-1 min-h-[60px] resize-none rounded border border-gray-200 px-2 py-1.5 text-sm focus:border-indigo-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSendReply}
            disabled={replyBusy || replyText.trim().length === 0}
            className="rounded bg-indigo-600 px-3 py-1.5 text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {replyBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {t("replySend")}
          </button>
        </div>
      ) : null}

      {expanded && (
        <div className="rounded border border-gray-200 bg-gray-50 px-2 py-2 text-xs text-gray-600">
          {task.triggerSummary && <p className="mb-2 text-gray-700">{task.triggerSummary}</p>}
          {messages.length > 0 ? (
            <ol className="space-y-1.5">
              {messages.map((m) => (
                <li key={m.id} className="flex gap-2 items-start border-l-2 border-gray-200 pl-2">
                  <span
                    className={`mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide shrink-0 ${KIND_BADGE[m.kind]}`}
                  >
                    {KIND_LABEL[m.kind]}
                  </span>
                  <div className="min-w-0 flex-1">{renderMessageContent(m)}</div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-gray-400 italic">{t("messagesEmpty")}</p>
          )}
          {messages.length === 0 && task.result && Object.keys(task.result).length > 0 && (
            <pre className="mt-2 font-mono text-[11px] whitespace-pre-wrap break-words text-gray-600">
              {JSON.stringify(task.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

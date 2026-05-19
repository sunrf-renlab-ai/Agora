"use client";
import type { Agent, AgentTask, WSMessage } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { AgentRunCard } from "@/components/issues/AgentRunCard";
import { useAgents } from "@/hooks/useAgents";
import { useTasksForIssue } from "@/hooks/useTasks";
import { useWSChannel } from "@/hooks/useWSChannel";

interface ExecutionLogSectionProps {
  token: string | null;
  workspaceId: string | null;
  issueId: string;
}

// Newest-first ordering: prefer createdAt as the stable timestamp because
// completedAt is null for active runs. Within equal timestamps, fall back
// to id so the ordering is deterministic.
function compareNewestFirst(a: AgentTask, b: AgentTask): number {
  const at = new Date(a.createdAt).getTime();
  const bt = new Date(b.createdAt).getTime();
  if (at !== bt) return bt - at;
  return b.id.localeCompare(a.id);
}

export function ExecutionLogSection({ token, workspaceId, issueId }: ExecutionLogSectionProps) {
  const t = useTranslations("issues.executionLogs");
  const qc = useQueryClient();

  const { data: tasks = [], isLoading } = useTasksForIssue(token, workspaceId, issueId);
  const { data: agentList = [] } = useAgents(token, workspaceId);

  const agentsById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agentList as Agent[]) map.set(a.id, a);
    return map;
  }, [agentList]);

  const sortedTasks = useMemo(() => [...tasks].sort(compareNewestFirst), [tasks]);

  // Live updates — the workspace channel emits task lifecycle events; we
  // refresh the cache when an event references this issue. Per-task
  // message deltas are handled inside useTaskMessages on a per-task
  // channel (task:<taskId>) so we DON'T listen for them here — that would
  // double-invalidate.
  useWSChannel(workspaceId, (msg: WSMessage) => {
    const event = msg.event;
    const matchesIssue =
      (event.type === "task.queued" ||
        event.type === "task.started" ||
        event.type === "task.completed" ||
        event.type === "task.failed") &&
      "issueId" in event.data &&
      event.data.issueId === issueId;
    // task.dispatched / task.cancelled don't carry issueId, so we
    // refetch unconditionally for those — cheap and keeps the section
    // honest when a row gets cancelled from elsewhere.
    if (matchesIssue || event.type === "task.dispatched" || event.type === "task.cancelled") {
      qc.invalidateQueries({ queryKey: ["tasks", workspaceId, issueId] });
    }
  });

  if (isLoading) {
    return <div className="text-sm text-gray-400 py-2">Loading…</div>;
  }

  if (sortedTasks.length === 0) {
    return <p className="text-sm text-gray-400">{t("empty")}</p>;
  }

  return (
    <div className="space-y-2">
      {sortedTasks.map((task) => (
        <AgentRunCard
          key={task.id}
          task={task}
          agentsById={agentsById}
          token={token}
          workspaceId={workspaceId}
        />
      ))}
    </div>
  );
}

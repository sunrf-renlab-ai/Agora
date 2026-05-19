"use client";
import type { ActivityEntry, Agent, AgentTask, WSMessage } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { ActivityRow } from "@/components/issues/ActivityList";
import { AgentRunCard } from "@/components/issues/AgentRunCard";
import { useAgents } from "@/hooks/useAgents";
import { useTasksForIssue } from "@/hooks/useTasks";
import { useWSChannel } from "@/hooks/useWSChannel";

export type TimelineEntry =
  | { kind: "activity"; createdAt: string; entry: ActivityEntry }
  | { kind: "task"; createdAt: string; task: AgentTask };

/**
 * Merge activity + tasks by createdAt ascending. Ties go to tasks so the
 * originating agent run shows above any system event it produced at the
 * same instant. Pure function so we can unit-test it cheaply.
 *
 * Comments are NOT merged here — 动态 (activity + agent runs) and 评论
 * are two separate sections. The empty-comment-list case makes them
 * look like one stream but they're architecturally distinct.
 */
export function mergeChronological(
  activity: ActivityEntry[],
  tasks: AgentTask[],
): TimelineEntry[] {
  const merged: TimelineEntry[] = [
    ...activity.map((entry) => ({ kind: "activity" as const, createdAt: entry.createdAt, entry })),
    ...tasks.map((task) => ({ kind: "task" as const, createdAt: task.createdAt, task })),
  ];
  merged.sort((a, b) => {
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    if (at !== bt) return at - bt;
    // tie-breaker: tasks before activity at the same instant
    if (a.kind === b.kind) return 0;
    return a.kind === "task" ? -1 : 1;
  });
  return merged;
}

interface TimelineProps {
  activity: ActivityEntry[];
  token: string | null;
  workspaceId: string | null;
  issueId: string;
}

export function Timeline({ activity, token, workspaceId, issueId }: TimelineProps) {
  const qc = useQueryClient();
  const { data: tasks = [] } = useTasksForIssue(token, workspaceId, issueId);
  const { data: agentList = [] } = useAgents(token, workspaceId);

  const agentsById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agentList as Agent[]) map.set(a.id, a);
    return map;
  }, [agentList]);

  // Re-fetch tasks when a workspace WS event references this issue.
  // Pattern copied verbatim from ExecutionLogSection — keep them in sync.
  useWSChannel(workspaceId, (msg: WSMessage) => {
    const event = msg.event;
    const matchesIssue =
      (event.type === "task.queued" ||
        event.type === "task.started" ||
        event.type === "task.completed" ||
        event.type === "task.failed") &&
      "issueId" in event.data &&
      event.data.issueId === issueId;
    if (matchesIssue || event.type === "task.dispatched" || event.type === "task.cancelled") {
      qc.invalidateQueries({ queryKey: ["tasks", workspaceId, issueId] });
    }
  });

  const merged = useMemo(
    () => mergeChronological(activity, tasks as AgentTask[]),
    [activity, tasks],
  );

  if (merged.length === 0) {
    return <p className="text-sm text-gray-400">No activity yet.</p>;
  }

  return (
    <div className="space-y-3">
      {merged.map((e) =>
        e.kind === "activity" ? (
          <ActivityRow key={`a:${e.entry.id}`} entry={e.entry} />
        ) : (
          <AgentRunCard
            key={`t:${e.task.id}`}
            task={e.task}
            agentsById={agentsById}
            token={token}
            workspaceId={workspaceId}
          />
        ),
      )}
    </div>
  );
}

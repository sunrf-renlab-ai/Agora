"use client";
import type { AgentTask, Issue, IssuePriority, IssueStatus } from "@agora/shared";
import { useTranslations } from "next-intl";

import { LabelPicker } from "@/components/labels/LabelPicker";
import { useTasksForIssue } from "@/hooks/useTasks";
import { PropertyRow } from "./PropertyRow";
import { PropertySection } from "./PropertySection";
import { aggregateUsage } from "./usage";

const STATUSES: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];
const PRIORITIES: IssuePriority[] = ["urgent", "high", "medium", "low", "none"];

interface PropertyPanelProps {
  issue: Issue;
  token: string | null;
  workspaceId: string | null;
  issueId: string;
  onStatusChange: (s: IssueStatus) => void;
  onPriorityChange: (p: IssuePriority) => void;
}

export function PropertyPanel({
  issue,
  token,
  workspaceId,
  issueId,
  onStatusChange,
  onPriorityChange,
}: PropertyPanelProps) {
  const t = useTranslations("issueDetail.properties");
  const { data: tasks = [] } = useTasksForIssue(token, workspaceId, issueId);
  const usage = aggregateUsage(tasks as AgentTask[]);

  return (
    <div className="space-y-5">
      <PropertySection title={t("attributes")}>
        <PropertyRow
          label={t("status")}
          value={
            <select
              aria-label={t("status")}
              value={issue.status}
              onChange={(e) => onStatusChange(e.target.value as IssueStatus)}
              className="w-full bg-transparent text-xs focus:outline-none"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          }
        />
        <PropertyRow
          label={t("priority")}
          value={
            <select
              aria-label={t("priority")}
              value={issue.priority}
              onChange={(e) => onPriorityChange(e.target.value as IssuePriority)}
              className="w-full bg-transparent text-xs focus:outline-none"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          }
        />
        <PropertyRow label={t("assignee")} value={issue.assignee?.name ?? t("unassigned")} />
        <PropertyRow
          label={t("dueDate")}
          value={
            issue.dueDate
              ? new Date(issue.dueDate).toLocaleDateString()
              : <span className="text-gray-400">—</span>
          }
        />
        <PropertyRow label={t("project")} value={<span className="text-gray-400">—</span>} />
        <PropertyRow
          label={t("labels")}
          value={
            token && workspaceId ? (
              <LabelPicker
                token={token}
                workspaceId={workspaceId}
                issueId={issueId}
                assigned={[]}
              />
            ) : (
              <span className="text-gray-400">—</span>
            )
          }
        />
      </PropertySection>

      <PropertySection title={t("pullRequest")} defaultOpen={false}>
        <p className="text-xs text-gray-500 col-span-2 px-2 py-1">{t("noPullRequest")}</p>
      </PropertySection>

      <PropertySection title={t("metadata")} defaultOpen={false}>
        <PropertyRow label={t("creator")} value={issue.creator?.name ?? t("unknown")} />
        <PropertyRow
          label={t("createdAt")}
          value={new Date(issue.createdAt).toLocaleDateString()}
        />
        <PropertyRow
          label={t("updatedAt")}
          value={new Date(issue.updatedAt).toLocaleDateString()}
        />
      </PropertySection>

      <PropertySection title={t("agentStats")} defaultOpen={false}>
        <PropertyRow label={t("inputTokens")} value={usage.inputTokens.toLocaleString()} />
        <PropertyRow label={t("outputTokens")} value={usage.outputTokens.toLocaleString()} />
        <PropertyRow label={t("cacheTokens")} value={usage.cacheTokens.toLocaleString()} />
        <PropertyRow label={t("runs")} value={String(usage.runs)} />
      </PropertySection>
    </div>
  );
}

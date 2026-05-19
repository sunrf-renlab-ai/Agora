"use client";
import { Popover } from "@/components/ui/Popover";
import { useAgents } from "@/hooks/useAgents";
import { useLabels } from "@/hooks/useLabels";
import { useMembers } from "@/hooks/useMembers";
import { useProjects } from "@/hooks/useProjects";
import type { IssuePriority, IssueStatus } from "@agora/shared";
import { Check, ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { PriorityIcon, StatusIcon, priorityLabel, statusLabel } from "./pickers/icons";

const STATUSES: IssueStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
  "backlog",
];

const PRIORITIES: IssuePriority[] = ["urgent", "high", "medium", "low"];

export interface IssueFilters {
  status: IssueStatus[];
  priority: IssuePriority[];
  /** Encoded as `${kind}:${id}` to disambiguate members from agents. */
  assignee: string[];
  project: string[];
  labels: string[];
}

export const EMPTY_FILTERS: IssueFilters = {
  status: [],
  priority: [],
  assignee: [],
  project: [],
  labels: [],
};

export function isAnyFilterActive(f: IssueFilters): boolean {
  return (
    f.status.length > 0 ||
    f.priority.length > 0 ||
    f.assignee.length > 0 ||
    f.project.length > 0 ||
    f.labels.length > 0
  );
}

interface Props {
  token: string | null;
  workspaceId: string | null;
  filters: IssueFilters;
  onChange: (next: IssueFilters) => void;
}

/**
 * Horizontal filter pills for the issues page. Each pill opens a popover with
 * a multi-select list. Active filters render with an indigo ring and a count
 * badge. A "Clear filters" button appears when any filter is active.
 */
export function IssueFilterBar({ token, workspaceId, filters, onChange }: Props) {
  const t = useTranslations("issues");

  const { data: members = [] } = useMembers(token, workspaceId);
  const { data: agents = [] } = useAgents(token, workspaceId);
  const { data: projects = [] } = useProjects(token, workspaceId);
  const { data: labels = [] } = useLabels(token, workspaceId);

  function toggle<T extends string>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  return (
    <div className="flex items-center gap-2 px-8 pt-3 pb-2 flex-wrap">
      {/* Status */}
      <FilterPill
        label={t("filters.status")}
        count={filters.status.length}
        renderContent={() => (
          <ul className="py-1 max-h-72 overflow-auto">
            {STATUSES.map((s) => {
              const checked = filters.status.includes(s);
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => onChange({ ...filters, status: toggle(filters.status, s) })}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-gray-50"
                  >
                    <StatusIcon status={s} className="size-3.5" />
                    <span className="flex-1">{statusLabel(s)}</span>
                    {checked && <Check className="size-3 text-indigo-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      />

      {/* Priority */}
      <FilterPill
        label={t("filters.priority")}
        count={filters.priority.length}
        renderContent={() => (
          <ul className="py-1 max-h-72 overflow-auto">
            {PRIORITIES.map((p) => {
              const checked = filters.priority.includes(p);
              return (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => onChange({ ...filters, priority: toggle(filters.priority, p) })}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-gray-50"
                  >
                    <PriorityIcon priority={p} className="size-3.5" />
                    <span className="flex-1">{priorityLabel(p)}</span>
                    {checked && <Check className="size-3 text-indigo-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      />

      {/* Assignee */}
      <FilterPill
        label={t("filters.assignee")}
        count={filters.assignee.length}
        renderContent={() => {
          const memberOptions = members.map((m) => ({
            value: `member:${m.userId}`,
            label: m.user.name,
          }));
          const agentOptions = agents
            .filter((a) => !a.archivedAt)
            .map((a) => ({ value: `agent:${a.id}`, label: a.name }));
          const all = [
            ...(memberOptions.length > 0
              ? [{ heading: t("filters.assignee"), items: memberOptions }]
              : []),
            ...(agentOptions.length > 0 ? [{ heading: "Agents", items: agentOptions }] : []),
          ];
          if (all.length === 0) {
            return <div className="px-3 py-2 text-[13px] text-gray-400">No assignees</div>;
          }
          return (
            <div className="py-1 max-h-72 overflow-auto">
              {all.map((group) => (
                <div key={group.heading}>
                  {group.items.map((opt) => {
                    const checked = filters.assignee.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          onChange({ ...filters, assignee: toggle(filters.assignee, opt.value) })
                        }
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-gray-50"
                      >
                        <span className="flex-1 truncate">{opt.label}</span>
                        {checked && <Check className="size-3 text-indigo-600" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        }}
      />

      {/* Project */}
      <FilterPill
        label={t("filters.project")}
        count={filters.project.length}
        renderContent={() => {
          if (projects.length === 0) {
            return <div className="px-3 py-2 text-[13px] text-gray-400">No projects</div>;
          }
          return (
            <ul className="py-1 max-h-72 overflow-auto">
              {projects.map((p) => {
                const checked = filters.project.includes(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() =>
                        onChange({ ...filters, project: toggle(filters.project, p.id) })
                      }
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-gray-50"
                    >
                      <span className="flex-1 truncate">{p.title}</span>
                      {checked && <Check className="size-3 text-indigo-600" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          );
        }}
      />

      {/* Labels */}
      <FilterPill
        label={t("filters.labels")}
        count={filters.labels.length}
        renderContent={() => {
          if (labels.length === 0) {
            return <div className="px-3 py-2 text-[13px] text-gray-400">No labels</div>;
          }
          return (
            <ul className="py-1 max-h-72 overflow-auto">
              {labels.map((l) => {
                const checked = filters.labels.includes(l.id);
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => onChange({ ...filters, labels: toggle(filters.labels, l.id) })}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-gray-50"
                    >
                      <span
                        className="size-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: l.color }}
                        aria-hidden
                      />
                      <span className="flex-1 truncate">{l.name}</span>
                      {checked && <Check className="size-3 text-indigo-600" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          );
        }}
      />

      {isAnyFilterActive(filters) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
        >
          <X className="size-3" />
          {t("filters.clearAll")}
        </button>
      )}
    </div>
  );
}

interface FilterPillProps {
  label: string;
  count: number;
  renderContent: () => React.ReactNode;
}

function FilterPill({ label, count, renderContent }: FilterPillProps) {
  const [open, setOpen] = useState(false);
  const active = count > 0;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-56 max-h-80"
      trigger={
        <button
          type="button"
          aria-pressed={active}
          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[13px] transition-colors ${
            active
              ? "border-indigo-600 bg-white text-indigo-700 ring-1 ring-indigo-600"
              : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          <span>{label}</span>
          {count > 0 && (
            <span className="ml-0.5 rounded bg-indigo-50 px-1 text-[11px] font-medium text-indigo-700 tabular-nums">
              {count}
            </span>
          )}
          <ChevronDown className="size-3 text-gray-400" />
        </button>
      }
    >
      {renderContent()}
    </Popover>
  );
}

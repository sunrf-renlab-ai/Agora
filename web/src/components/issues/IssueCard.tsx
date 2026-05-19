import type { Issue, IssuePriority } from "@agora/shared";
import Link from "next/link";
import { PriorityIcon } from "./pickers/icons";
import { StatusBadge } from "./StatusBadge";

const PRIORITY_ZH: Record<IssuePriority, string> = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
  none: "",
};

interface Props {
  issue: Issue;
  workspaceSlug: string;
  /** Layout variant. `card` is vertical stacked (Kanban). `row` is horizontal compact (List). */
  variant?: "card" | "row";
}

/** Strip markdown punctuation and collapse whitespace for a short description preview. */
function snippet(text: string | null, max = 80): string {
  if (!text) return "";
  const stripped = text
    .replace(/[#*_`>]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped;
}

const PRIORITY_STYLES: Record<IssuePriority, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-gray-100 text-gray-600",
  none: "bg-gray-100 text-gray-400",
};

const MAX_LABELS = 3;

/**
 * Colored circle with the assignee's initial. Falls back to "?" if the name is empty.
 */
function AssigneeAvatar({
  name,
  size = "sm",
}: {
  name: string;
  size?: "sm" | "md";
}) {
  const initial = name[0]?.toUpperCase() ?? "?";
  const sizeClass = size === "md" ? "w-6 h-6 text-xs" : "w-5 h-5 text-[10px]";
  return (
    <span
      className={`${sizeClass} rounded-full bg-indigo-200 text-indigo-800 flex items-center justify-center font-bold shrink-0`}
      title={name}
    >
      {initial}
    </span>
  );
}

function PriorityPill({ priority }: { priority: IssuePriority }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${PRIORITY_STYLES[priority]}`}
    >
      {priority}
    </span>
  );
}

/**
 * Compact priority indicator used inside Kanban cards: horizontal bars icon
 * (via PriorityIcon) plus a single-character Chinese label. Renders nothing
 * for `none` since an empty pill is just visual noise.
 */
function PriorityBadge({ priority }: { priority: IssuePriority }) {
  if (priority === "none") return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-gray-600">
      <PriorityIcon priority={priority} className="size-3.5" />
      {PRIORITY_ZH[priority]}
    </span>
  );
}

function LabelTag({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {name}
    </span>
  );
}

export function IssueCard({ issue, workspaceSlug, variant = "card" }: Props) {
  const labels = issue.labels ?? [];
  const visibleLabels = labels.slice(0, MAX_LABELS);
  const extraLabelCount = labels.length - visibleLabels.length;
  const href = `/${workspaceSlug}/issues/${issue.id}`;

  if (variant === "row") {
    return (
      <Link
        href={href}
        className="flex items-center gap-4 px-8 py-3 border-b border-gray-200 hover:bg-gray-50 group transition-colors"
      >
        <span className="font-display italic text-[15px] text-gray-400 w-20 shrink-0 tabular-nums">
          {issue.identifier}
        </span>
        <span className="text-[14px] font-medium text-gray-900 truncate min-w-0 max-w-xs">
          {issue.title}
        </span>
        {visibleLabels.map((l) => (
          <LabelTag key={l.id} name={l.name} color={l.color} />
        ))}
        {extraLabelCount > 0 && (
          <span className="text-[10px] text-gray-400 shrink-0">+{extraLabelCount} more</span>
        )}
        <span className="text-[13px] text-gray-400 truncate flex-1 min-w-0">
          {snippet(issue.description)}
        </span>
        <PriorityPill priority={issue.priority} />
        <StatusBadge status={issue.status} />
        {issue.assignee && <AssigneeAvatar name={issue.assignee.name} size="md" />}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="group block bg-white rounded-md border border-gray-200 px-3 py-2.5 hover:border-gray-300 hover:shadow-[0_2px_6px_rgba(0,0,0,0.04)] transition-all"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-display italic text-[12px] text-gray-400 tabular-nums">
          {issue.identifier}
        </span>
        {issue.priority !== "none" && (
          <span className="ml-auto">
            <PriorityIcon priority={issue.priority} className="size-3.5" />
          </span>
        )}
      </div>
      <div className="text-[13px] font-medium text-gray-900 line-clamp-2 mb-1.5 leading-snug group-hover:text-gray-900">
        {issue.title}
      </div>
      {labels.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mb-2">
          {visibleLabels.map((l) => (
            <LabelTag key={l.id} name={l.name} color={l.color} />
          ))}
          {extraLabelCount > 0 && (
            <span className="text-[10px] text-gray-400">+{extraLabelCount}</span>
          )}
        </div>
      )}
      {issue.description && (
        <div className="text-[12px] text-gray-500 line-clamp-2 mb-2 leading-relaxed">
          {snippet(issue.description)}
        </div>
      )}
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
        {issue.assignee ? (
          <AssigneeAvatar name={issue.assignee.name} />
        ) : (
          <span
            className="w-5 h-5 rounded-full border border-dashed border-gray-300 shrink-0"
            title="Unassigned"
          />
        )}
        <span className="text-[11px] text-gray-500 truncate">
          {issue.assignee?.name ?? "Unassigned"}
        </span>
      </div>
    </Link>
  );
}

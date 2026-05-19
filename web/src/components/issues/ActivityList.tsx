import type { ActivityEntry } from "@agora/shared";
import { timeAgo } from "@/components/inbox/InboxListItem";

const ACTION_LABELS: Record<string, (details: Record<string, unknown>) => string> = {
  "issue.created": () => "created this issue",
  "issue.status_changed": (d) => `changed status from ${d.from} to ${d.to}`,
  "comment.created": () => "added a comment",
};

// Single-line activity row: small avatar, name, verb,
// timestamp pushed to the right gutter. Reads as a quiet "X did Y" log
// entry, not a UI primitive that demands attention.
export function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const label = ACTION_LABELS[entry.action]?.(entry.details) ?? entry.action;
  return (
    <div className="flex items-center gap-2 text-[13px] text-gray-600 py-1">
      <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-semibold shrink-0 text-gray-700">
        {entry.actor?.name[0]?.toUpperCase() ?? "?"}
      </div>
      <span className="font-medium text-gray-700">{entry.actor?.name ?? "System"}</span>
      <span className="text-gray-500 truncate">{label}</span>
      <span className="ml-auto text-[11px] text-gray-400 shrink-0 tabular-nums">
        {timeAgo(entry.createdAt)}
      </span>
    </div>
  );
}

export function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-gray-400">No activity yet.</p>;
  }
  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

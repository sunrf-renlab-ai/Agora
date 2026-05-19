import type { IssuePriority } from "@agora/shared";

const ICONS: Record<IssuePriority, string> = {
  urgent: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  none: "⬜",
};

export function PriorityIcon({ priority }: { priority: IssuePriority }) {
  return (
    <span role="img" aria-label={priority}>
      {ICONS[priority]}
    </span>
  );
}

import type { IssueStatus } from "@agora/shared";
import { useTranslations } from "next-intl";

const STATUS_STYLES: Record<IssueStatus, string> = {
  backlog: "bg-gray-100 text-gray-600",
  todo: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  in_review: "bg-purple-100 text-purple-700",
  done: "bg-green-100 text-green-700",
  blocked: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-400 line-through",
};

export function StatusBadge({ status }: { status: IssueStatus }) {
  const t = useTranslations("issueStatus");
  const className = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}
    >
      {t(status)}
    </span>
  );
}

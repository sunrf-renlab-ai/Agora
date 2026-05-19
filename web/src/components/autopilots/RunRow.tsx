"use client";
import type { AutopilotRun, AutopilotRunStatus } from "@agora/shared";
import Link from "next/link";

const STATUS_COLORS: Record<AutopilotRunStatus, string> = {
  issue_created: "bg-blue-100 text-blue-800",
  running: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

export function RunRow({ run, workspaceSlug }: { run: AutopilotRun; workspaceSlug: string }) {
  const triggered = new Date(run.triggeredAt).toLocaleString();
  const completed = run.completedAt ? new Date(run.completedAt).toLocaleString() : null;
  return (
    <div className="border rounded p-3 space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[run.status]}`}>
            {run.status}
          </span>
          <span className="text-xs text-gray-500">{run.source}</span>
        </div>
        {run.issueId && (
          <Link
            href={`/${workspaceSlug}/issues/${run.issueId}`}
            className="text-xs text-indigo-600 underline"
          >
            View issue
          </Link>
        )}
      </div>
      <div className="text-xs text-gray-500">
        Triggered {triggered}
        {completed && <span> · Completed {completed}</span>}
      </div>
      {run.failureReason && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {run.failureReason}
        </div>
      )}
    </div>
  );
}

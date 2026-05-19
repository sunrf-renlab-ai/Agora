"use client";
import { IssueDetailView } from "@/components/issues/IssueDetailView";
import type { InboxItem } from "@agora/shared";
import { Archive } from "lucide-react";
import { typeLabel } from "./inbox-display";
import { timeAgo } from "./InboxListItem";

interface Props {
  item: InboxItem;
  workspaceSlug: string;
  token: string | null;
  workspaceId: string | null;
  userId: string | null;
  onArchive: () => void;
}

export function InboxDetail({
  item,
  workspaceSlug,
  token,
  workspaceId,
  userId,
  onArchive,
}: Props) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-6 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-500">
            <span>{typeLabel(item.type)}</span>
            <span>·</span>
            <span>{timeAgo(item.createdAt)}</span>
          </div>
          <h1 className="mt-1 truncate text-[16px] font-semibold tracking-tight text-gray-900">
            {item.title}
          </h1>
        </div>
        <button
          type="button"
          onClick={onArchive}
          aria-label="Archive"
          title="Archive"
          className="flex shrink-0 items-center gap-1.5 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          <Archive className="size-3.5" />
          Archive
        </button>
      </div>

      {/* Body */}
      {item.issueId ? (
        <div className="flex-1 overflow-hidden">
          <IssueDetailView
            issueId={item.issueId}
            workspaceSlug={workspaceSlug}
            token={token}
            workspaceId={workspaceId}
            userId={userId}
            embedded
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {item.body && (
            <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-700">
              {item.body}
            </div>
          )}
          <p className="text-[13px] text-gray-500">
            This notification isn't tied to an issue.
          </p>
        </div>
      )}
    </div>
  );
}

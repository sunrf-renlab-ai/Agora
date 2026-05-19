"use client";
import { Archive } from "lucide-react";
import { useState } from "react";
import type { InboxItem } from "@agora/shared";
import { typeLabel, typeBadgeColor } from "./inbox-display";

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface Props {
  item: InboxItem;
  selected: boolean;
  onClick: () => void;
  onArchive: () => void;
}

export function InboxListItem({ item, selected, onClick, onArchive }: Props) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`group flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors ${
        selected ? "bg-indigo-50/60" : "hover:bg-gray-50"
      }`}
    >
      {/* Unread dot */}
      <div className="flex w-2 justify-center pt-1.5 shrink-0">
        {!item.read && <span className="block size-2 rounded-full bg-indigo-600" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`truncate text-[13px] ${item.read ? "text-gray-500" : "font-medium text-gray-900"}`}
          >
            {item.title}
          </span>
          <span className="text-[11px] text-gray-400 shrink-0">{timeAgo(item.createdAt)}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${typeBadgeColor(item.type)}`}
          >
            {typeLabel(item.type)}
          </span>
          {item.body && (
            <span className="truncate text-[11px] text-gray-500">{item.body}</span>
          )}
        </div>
      </div>
      {/* Hover archive */}
      {hover && (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onArchive();
            }
          }}
          aria-label="Archive"
          title="Archive"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 shrink-0"
        >
          <Archive className="size-3.5" />
        </span>
      )}
    </button>
  );
}

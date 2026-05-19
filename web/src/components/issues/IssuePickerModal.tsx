"use client";
import { api } from "@/lib/api";
import type { Issue } from "@agora/shared";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StatusIcon } from "./pickers/icons";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  excludeIds?: string[];
  token: string | null;
  workspaceId: string | null;
  onSelect: (issue: Issue) => void;
}

// Search-driven picker for "set parent" and "add sub-issue". Renders as
// its own Portal-style overlay above the create-issue dialog. Empty query
// shows recent issues.
export function IssuePickerModal({
  open,
  onClose,
  title,
  description,
  excludeIds = [],
  token,
  workspaceId,
  onSelect,
}: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);

  useEffect(() => {
    if (!open || !token || !workspaceId) return;
    let cancelled = false;
    setLoading(true);
    const run = async () => {
      try {
        const data = q.trim()
          ? ((await api.searchIssues(token, workspaceId, q.trim())) as { items: Issue[] }).items
          : ((await api.listIssues(token, workspaceId)) as Issue[]);
        if (cancelled) return;
        setResults(data.filter((i) => !exclude.has(i.id)).slice(0, 30));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const t = setTimeout(run, q.trim() ? 200 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, q, token, workspaceId, exclude]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled at document level
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 px-4 pt-24"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        // biome-ignore lint/a11y/useSemanticElements: native dialog doesn't support our custom positioning
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <Search className="size-3.5 text-gray-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={description ?? title}
            className="flex-1 bg-transparent text-[13px] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {loading && results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400">
              {q.trim() ? "No matches." : "No issues yet."}
            </div>
          ) : (
            results.map((iss) => (
              <button
                key={iss.id}
                type="button"
                onClick={() => {
                  onSelect(iss);
                  onClose();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                <StatusIcon status={iss.status} className="size-3.5 shrink-0" />
                <span className="font-mono text-[11px] text-gray-500 shrink-0">
                  {iss.identifier ?? `#${iss.number}`}
                </span>
                <span className="flex-1 truncate text-gray-900">{iss.title}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

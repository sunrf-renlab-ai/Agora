"use client";
import { Popover } from "@/components/ui/Popover";
import { useToast } from "@/components/ui/Toast";
import { useAgents } from "@/hooks/useAgents";
import { useMembers } from "@/hooks/useMembers";
import { api } from "@/lib/api";
import type { IssuePriority, IssueStatus } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
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

const PRIORITIES: IssuePriority[] = ["urgent", "high", "medium", "low", "none"];

interface Props {
  selectedIds: string[];
  token: string | null;
  workspaceId: string | null;
  onClear: () => void;
}

/**
 * Sticky bottom toolbar that appears when one or more issues are selected.
 * Provides bulk status / priority / assignee changes and bulk delete.
 */
export function BatchActionToolbar({ selectedIds, token, workspaceId, onClear }: Props) {
  const t = useTranslations("issues");
  const { toast } = useToast();
  const qc = useQueryClient();
  const count = selectedIds.length;

  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: members = [] } = useMembers(token, workspaceId);
  const { data: agents = [] } = useAgents(token, workspaceId);

  if (count === 0 || !token || !workspaceId) return null;

  async function applyUpdate(data: Record<string, unknown>) {
    if (!token || !workspaceId) return;
    setBusy(true);
    try {
      await api.batchUpdateIssues(token, workspaceId, selectedIds, data);
      qc.invalidateQueries({ queryKey: ["issues", workspaceId] });
      toast(t("batch.updated", { count }), "success");
    } catch {
      toast(t("batch.updateFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function applyDelete() {
    if (!token || !workspaceId) return;
    setBusy(true);
    try {
      await api.batchDeleteIssues(token, workspaceId, selectedIds);
      qc.invalidateQueries({ queryKey: ["issues", workspaceId] });
      toast(t("batch.deleted", { count }), "success");
      onClear();
    } catch {
      toast(t("batch.deleteFailed"), "error");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 shadow-md">
        <div className="flex items-center gap-1.5 pl-1 pr-2 mr-1 border-r border-gray-200">
          <span className="text-[13px] font-medium text-gray-900">
            {t("batch.selectedCount", { count })}
          </span>
          <button
            type="button"
            onClick={onClear}
            aria-label={t("batch.clear")}
            className="rounded p-0.5 hover:bg-gray-100 transition-colors"
          >
            <X className="size-3.5 text-gray-500" />
          </button>
        </div>

        {/* Status */}
        <Popover
          open={statusOpen}
          onOpenChange={setStatusOpen}
          align="center"
          side="top"
          className="w-44"
          trigger={
            <button
              type="button"
              disabled={busy}
              className="rounded px-2 py-1 text-[13px] text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("batch.status")}
            </button>
          }
        >
          <ul className="py-1 max-h-72 overflow-auto">
            {STATUSES.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={async () => {
                    setStatusOpen(false);
                    await applyUpdate({ status: s });
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-gray-50"
                >
                  <StatusIcon status={s} className="size-3.5" />
                  <span>{statusLabel(s)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>

        {/* Priority */}
        <Popover
          open={priorityOpen}
          onOpenChange={setPriorityOpen}
          align="center"
          side="top"
          className="w-44"
          trigger={
            <button
              type="button"
              disabled={busy}
              className="rounded px-2 py-1 text-[13px] text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("batch.priority")}
            </button>
          }
        >
          <ul className="py-1 max-h-72 overflow-auto">
            {PRIORITIES.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={async () => {
                    setPriorityOpen(false);
                    await applyUpdate({ priority: p });
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-gray-50"
                >
                  <PriorityIcon priority={p} className="size-3.5" />
                  <span>{priorityLabel(p)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>

        {/* Assignee */}
        <Popover
          open={assigneeOpen}
          onOpenChange={setAssigneeOpen}
          align="center"
          side="top"
          className="w-56"
          trigger={
            <button
              type="button"
              disabled={busy}
              className="rounded px-2 py-1 text-[13px] text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("batch.assignee")}
            </button>
          }
        >
          <div className="py-1 max-h-72 overflow-auto">
            <button
              type="button"
              onClick={async () => {
                setAssigneeOpen(false);
                await applyUpdate({ assigneeKind: null, assigneeId: null });
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] text-gray-500 hover:bg-gray-50"
            >
              <span className="flex-1">—</span>
            </button>
            {members.map((m) => (
              <button
                key={`member:${m.userId}`}
                type="button"
                onClick={async () => {
                  setAssigneeOpen(false);
                  await applyUpdate({ assigneeKind: "member", assigneeId: m.userId });
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-gray-50"
              >
                <span className="flex-1 truncate">{m.user.name}</span>
              </button>
            ))}
            {agents
              .filter((a) => !a.archivedAt)
              .map((a) => (
                <button
                  key={`agent:${a.id}`}
                  type="button"
                  onClick={async () => {
                    setAssigneeOpen(false);
                    await applyUpdate({ assigneeKind: "agent", assigneeId: a.id });
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-gray-50"
                >
                  <span className="flex-1 truncate">{a.name}</span>
                </button>
              ))}
          </div>
        </Popover>

        {/* Delete */}
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[13px] text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Trash2 className="size-3.5" />
          {t("batch.delete")}
        </button>
      </div>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirmOpen(false);
          }}
          role="presentation"
        >
          <div className="rounded-lg border border-gray-200 bg-white shadow-xl w-full max-w-sm p-5">
            <h2 className="text-base font-semibold text-gray-900">
              {t("batch.deleteConfirm", { count })}
            </h2>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t("batch.cancel")}
              </button>
              <button
                type="button"
                onClick={applyDelete}
                disabled={busy}
                className="rounded-md bg-red-600 px-3 py-1.5 text-[13px] text-white hover:bg-red-700 disabled:opacity-50"
              >
                {t("batch.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

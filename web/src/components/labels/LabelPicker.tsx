"use client";
import { LabelChip } from "@/components/labels/LabelChip";
import { useAssignIssueLabels, useCreateLabel, useLabels } from "@/hooks/useLabels";
import type { Label } from "@agora/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function LabelPicker({
  token,
  workspaceId,
  issueId,
  assigned,
}: {
  token: string;
  workspaceId: string;
  issueId: string;
  assigned: { id: string; name: string; color: string }[];
}) {
  const labels = useLabels(token, workspaceId);
  const create = useCreateLabel(token, workspaceId);
  const assign = useAssignIssueLabels(token, workspaceId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const t = useTranslations("labels.picker");

  const assignedIds = new Set(assigned.map((l) => l.id));

  const toggle = (labelId: string) => {
    const next = assignedIds.has(labelId)
      ? assigned.filter((l) => l.id !== labelId).map((l) => l.id)
      : [...assigned.map((l) => l.id), labelId];
    assign.mutate({ issueId, labelIds: next });
  };

  const remove = (labelId: string) => {
    const next = assigned.filter((l) => l.id !== labelId).map((l) => l.id);
    assign.mutate({ issueId, labelIds: next });
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1">
        {assigned.map((l) => (
          <LabelChip key={l.id} name={l.name} color={l.color} onRemove={() => remove(l.id)} />
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
        >
          {t("addButton")}
        </button>
      </div>
      {open ? (
        <div className="absolute z-10 mt-1 w-64 rounded border border-gray-200 bg-white p-2 shadow">
          <ul className="max-h-48 overflow-auto">
            {(labels.data ?? []).map((l: Label) => {
              const isAssigned = assignedIds.has(l.id);
              const cbId = `label-cb-${l.id}`;
              return (
                <li key={l.id}>
                  <label
                    htmlFor={cbId}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-gray-50"
                  >
                    <input
                      id={cbId}
                      type="checkbox"
                      checked={isAssigned}
                      onChange={() => toggle(l.id)}
                    />
                    <LabelChip name={l.name} color={l.color} />
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 border-t border-gray-200 pt-2">
            <div className="flex gap-1">
              <label htmlFor="new-label-name" className="sr-only">
                {t("newLabelName")}
              </label>
              <input
                id="new-label-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("newLabelName")}
                className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
              />
              <label htmlFor="new-label-color" className="sr-only">
                {t("newLabelColor")}
              </label>
              <input
                id="new-label-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-7 w-7 rounded border border-gray-200"
              />
              <button
                type="button"
                disabled={!name.trim()}
                onClick={() => {
                  create.mutate(
                    { name: name.trim(), color },
                    {
                      onSuccess: (l) => {
                        const created = l as { id: string };
                        assign.mutate({
                          issueId,
                          labelIds: [...assigned.map((x) => x.id), created.id],
                        });
                        setName("");
                      },
                    },
                  );
                }}
                className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                {t("addAction")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

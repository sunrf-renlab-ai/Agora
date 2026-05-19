"use client";
import { Popover } from "@/components/ui/Popover";
import { PillButton } from "@/components/ui/PillButton";
import type { IssueStatus } from "@agora/shared";
import { Check } from "lucide-react";
import { useState } from "react";
import { StatusIcon, statusLabel } from "./icons";

const STATUSES: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];

interface Props {
  status: IssueStatus;
  onChange: (s: IssueStatus) => void;
}

export function StatusPicker({ status, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-44 py-1"
      trigger={
        <PillButton aria-label="Change status">
          <StatusIcon status={status} className="size-3.5" />
          <span>{statusLabel(status)}</span>
        </PillButton>
      }
    >
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => {
            onChange(s);
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-gray-50"
        >
          <StatusIcon status={s} className="size-3.5" />
          <span className="flex-1">{statusLabel(s)}</span>
          {status === s && <Check className="size-3 text-gray-500" />}
        </button>
      ))}
    </Popover>
  );
}

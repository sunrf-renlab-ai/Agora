"use client";
import { Popover } from "@/components/ui/Popover";
import { PillButton } from "@/components/ui/PillButton";
import { Calendar, X } from "lucide-react";
import { useState } from "react";

interface Props {
  /** ISO date string (YYYY-MM-DD) or null. */
  dueDate: string | null;
  onChange: (dueDate: string | null) => void;
}

function formatDue(d: string | null): string {
  if (!d) return "Due date";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dt);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 0 && diffDays < 7) return `In ${diffDays} days`;
  return target.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function DueDatePicker({ dueDate, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-56 p-2"
      trigger={
        <PillButton aria-label="Set due date">
          <Calendar className="size-3.5 text-gray-500" />
          <span>{formatDue(dueDate)}</span>
        </PillButton>
      }
    >
      <input
        type="date"
        value={dueDate ?? ""}
        onChange={(e) => {
          onChange(e.target.value || null);
        }}
        className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-indigo-600 focus:outline-none"
      />
      {dueDate && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          className="mt-2 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-gray-500 hover:bg-gray-50"
        >
          <X className="size-3" />
          Clear
        </button>
      )}
    </Popover>
  );
}

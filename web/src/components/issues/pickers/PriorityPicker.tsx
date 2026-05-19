"use client";
import { Popover } from "@/components/ui/Popover";
import { PillButton } from "@/components/ui/PillButton";
import type { IssuePriority } from "@agora/shared";
import { Check } from "lucide-react";
import { useState } from "react";
import { PriorityIcon, priorityLabel } from "./icons";

const PRIORITIES: IssuePriority[] = ["urgent", "high", "medium", "low", "none"];

interface Props {
  priority: IssuePriority;
  onChange: (p: IssuePriority) => void;
}

export function PriorityPicker({ priority, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-44 py-1"
      trigger={
        <PillButton aria-label="Change priority">
          <PriorityIcon priority={priority} className="size-3.5" />
          <span>{priorityLabel(priority)}</span>
        </PillButton>
      }
    >
      {PRIORITIES.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => {
            onChange(p);
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-gray-50"
        >
          <PriorityIcon priority={p} className="size-3.5" />
          <span className="flex-1">{priorityLabel(p)}</span>
          {priority === p && <Check className="size-3 text-gray-500" />}
        </button>
      ))}
    </Popover>
  );
}

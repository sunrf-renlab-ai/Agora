"use client";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

interface PropertySectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Right-sidebar collapsible section. The body uses `grid-cols-[auto_1fr]`
 * so child <PropertyRow>s align label/value across the section via
 * `grid-cols-subgrid`.
 */
export function PropertySection({ title, defaultOpen = true, children }: PropertySectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
        )}
        {title}
      </button>
      {open ? (
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pl-2">{children}</div>
      ) : null}
    </div>
  );
}

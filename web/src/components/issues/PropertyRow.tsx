import type { ReactNode } from "react";

interface PropertyRowProps {
  label: string;
  value: ReactNode;
}

/**
 * One line in the right-sidebar property panel. Grid layout: a small
 * left column with the field name, the value taking the rest of the row.
 */
export function PropertyRow({ label, value }: PropertyRowProps) {
  return (
    <div className="-mx-2 col-span-2 grid min-h-8 grid-cols-subgrid items-center rounded-md px-2 transition-colors hover:bg-gray-50">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5 truncate text-xs text-gray-800">
        {value}
      </div>
    </div>
  );
}

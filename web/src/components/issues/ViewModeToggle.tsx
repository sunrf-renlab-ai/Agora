"use client";
import { LayoutGrid, List, Network, User as UserIcon } from "lucide-react";

export type IssueView = "kanban" | "list" | "my" | "graph";

interface Props {
  view: IssueView;
  onViewChange: (v: IssueView) => void;
}

const MODES: Array<{ value: IssueView; label: string; Icon: typeof List }> = [
  { value: "kanban", label: "Kanban", Icon: LayoutGrid },
  { value: "list", label: "List", Icon: List },
  { value: "my", label: "My", Icon: UserIcon },
  { value: "graph", label: "Graph", Icon: Network },
];

/**
 * Three-way toggle between Kanban / List / My views on the issues page.
 * Highlights the active mode and emits the selected view via {@link onViewChange}.
 */
export function ViewModeToggle({ view, onViewChange }: Props) {
  return (
    <div className="inline-flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
      {MODES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => onViewChange(value)}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-sm font-medium transition-colors ${
            view === value
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

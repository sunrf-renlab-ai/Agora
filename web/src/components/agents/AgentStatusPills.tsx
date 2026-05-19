"use client";

export type AgentScope = "mine" | "all";
export type AgentStatusFilter = "all" | "online" | "unstable" | "offline";

interface Props {
  scope: AgentScope;
  status: AgentStatusFilter;
  onScope: (s: AgentScope) => void;
  onStatus: (s: AgentStatusFilter) => void;
  counts?: Partial<Record<AgentStatusFilter, number>>;
}

const SCOPES: Array<{ v: AgentScope; label: string }> = [
  { v: "mine", label: "Mine" },
  { v: "all", label: "All" },
];

const STATUSES: Array<{ v: AgentStatusFilter; label: string }> = [
  { v: "all", label: "All" },
  { v: "online", label: "Online" },
  { v: "unstable", label: "Unstable" },
  { v: "offline", label: "Offline" },
];

export function AgentStatusPills({ scope, status, onScope, onStatus, counts }: Props) {
  return (
    <div className="flex items-center gap-4 px-6 py-3 border-b">
      <div className="flex items-center gap-1">
        {SCOPES.map((s) => (
          <button
            key={s.v}
            type="button"
            onClick={() => onScope(s.v)}
            className={`px-3 py-1 text-sm rounded ${
              scope === s.v ? "bg-indigo-100 text-indigo-700 font-medium" : "text-gray-600"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="ml-4 flex items-center gap-1">
        {STATUSES.map((s) => {
          const count = counts?.[s.v];
          return (
            <button
              key={s.v}
              type="button"
              onClick={() => onStatus(s.v)}
              className={`px-2 py-0.5 text-xs rounded-full border ${
                status === s.v
                  ? "bg-gray-900 text-white border-gray-900"
                  : "text-gray-500 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {s.label}
              {typeof count === "number" ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

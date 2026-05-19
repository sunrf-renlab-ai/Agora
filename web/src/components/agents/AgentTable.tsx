"use client";
import Link from "next/link";

export type AgentRowStatus = "online" | "unstable" | "offline";

export interface AgentTableRow {
  id: string;
  name: string;
  description: string;
  runtimeId: string | null;
  runtimeName?: string | null;
  status: AgentRowStatus;
  workload?: number;
  maxConcurrentTasks?: number;
}

interface Props {
  agents: AgentTableRow[];
  workspaceSlug: string;
}

const STATUS_DOT: Record<AgentRowStatus, string> = {
  online: "bg-green-500",
  unstable: "bg-yellow-500",
  offline: "bg-gray-400",
};

export function AgentTable({ agents, workspaceSlug }: Props) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-gray-500 border-b">
        <tr>
          <th className="text-left font-medium px-6 py-2">Agent</th>
          <th className="text-left font-medium px-2 py-2">Status</th>
          <th className="text-left font-medium px-2 py-2">Workload</th>
          <th className="text-left font-medium px-2 py-2">Runtime</th>
        </tr>
      </thead>
      <tbody>
        {agents.map((a) => (
          <tr key={a.id} className="border-b hover:bg-gray-50">
            <td className="px-6 py-2">
              <Link
                href={`/${workspaceSlug}/agents/${a.id}`}
                className="font-medium text-indigo-600 hover:underline"
              >
                {a.name}
              </Link>
              <div className="text-xs text-gray-500 truncate max-w-md">{a.description}</div>
            </td>
            <td className="px-2 py-2">
              <span className="inline-flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${STATUS_DOT[a.status]}`} />
                <span className="capitalize">{a.status}</span>
              </span>
            </td>
            <td className="px-2 py-2 text-gray-600">
              {typeof a.workload === "number"
                ? `${a.workload}${
                    typeof a.maxConcurrentTasks === "number" ? ` / ${a.maxConcurrentTasks}` : ""
                  }`
                : "—"}
            </td>
            <td className="px-2 py-2 text-gray-600">{a.runtimeName ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

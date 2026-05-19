"use client";
import type { Agent } from "@agora/shared";
import Link from "next/link";

export function AgentRow({ agent, workspaceSlug }: { agent: Agent; workspaceSlug: string }) {
  return (
    <Link
      href={`/${workspaceSlug}/agents/${agent.id}`}
      className="flex items-center justify-between rounded border p-3 hover:bg-gray-50"
    >
      <div>
        <div className="font-medium">{agent.name}</div>
        <div className="text-xs text-gray-500">
          {agent.cliKind} · {agent.visibility}
        </div>
      </div>
      <div className="text-xs text-gray-500">{agent.archivedAt ? "archived" : "active"}</div>
    </Link>
  );
}

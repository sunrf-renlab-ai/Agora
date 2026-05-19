"use client";
import type { Agent } from "@agora/shared";
import { useTranslations } from "next-intl";
import Link from "next/link";

interface Props {
  agents: Agent[];
  workspaceSlug: string;
}

/**
 * Lists agents bound to a runtime via `agent.runtimeId`. Each row links to
 * the agent detail page. Concurrent task count comes from the agent's
 * configured `maxConcurrentTasks` cap — agora doesn't expose live running
 * counts in a workspace-wide query yet, so capacity is the closest signal
 * we can render without adding a new endpoint in this lane.
 */
export function RuntimeAgentsList({ agents, workspaceSlug }: Props) {
  const t = useTranslations("runtimes");
  const visible = agents.filter((a) => !a.archivedAt);

  return (
    <div className="rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
        <span className="text-[13px] font-semibold">{t("detail.agents.title")}</span>
        <span className="text-xs text-gray-400">{visible.length}</span>
      </div>

      {visible.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-gray-400">
          {t("detail.agents.empty")}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {visible.map((agent) => (
            <li key={agent.id}>
              <Link
                href={`/${workspaceSlug}/agents/${agent.id}`}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{agent.name}</div>
                  {agent.cliKind && (
                    <div className="mt-0.5 truncate font-mono text-[11px] text-gray-500">
                      {agent.cliKind}
                      {agent.model && <span className="ml-2 text-gray-400">{agent.model}</span>}
                    </div>
                  )}
                </div>
                <div className="ml-3 shrink-0 text-[12px] text-gray-500">
                  {t("detail.agents.concurrentTasks", {
                    count: agent.maxConcurrentTasks,
                  })}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

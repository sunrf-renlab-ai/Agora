"use client";
import { RuntimeAgentsList } from "@/components/runtimes/RuntimeAgentsList";
import { RuntimeStatusCard } from "@/components/runtimes/RuntimeStatusCard";
import { useAgents } from "@/hooks/useAgents";
import { useRuntimes } from "@/hooks/useRuntimes";
import { useWSChannel } from "@/hooks/useWSChannel";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { WSMessage } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { use, useEffect, useState } from "react";

const supabase = createClient();

export default function RuntimeDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { workspaceSlug, id } = use(params);
  const t = useTranslations("runtimes");
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const t = data.session.access_token;
      setToken(t);
      const workspaces = await api.listWorkspaces(t);
      const ws = (workspaces as Array<{ id: string; slug: string }>).find(
        (w) => w.slug === workspaceSlug,
      );
      if (ws) setWorkspaceId(ws.id);
    });
  }, [workspaceSlug]);

  // Keep online/offline + heartbeat fresh while the page is open. The list
  // query is the single source of truth for runtime membership in agora;
  // there is no per-runtime fetch endpoint, so we invalidate the list and
  // re-derive on every relevant WS event.
  useWSChannel(workspaceId, (msg: WSMessage) => {
    const eventType = msg.event.type;
    if (eventType === "runtime.online" || eventType === "runtime.offline") {
      qc.invalidateQueries({ queryKey: ["runtimes", workspaceId] });
    }
  });

  const { data: runtimes = [], isLoading: runtimesLoading } = useRuntimes(token, workspaceId);
  const { data: agents = [], isLoading: agentsLoading } = useAgents(token, workspaceId);

  const runtime = runtimes.find((r) => r.id === id) ?? null;
  const runtimeAgents = agents.filter((a) => a.runtimeId === id);

  const isLoading = runtimesLoading || agentsLoading;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 px-6 py-4">
        <Link
          href={`/${workspaceSlug}/runtimes`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"
        >
          ← {t("backToList")}
        </Link>

        {isLoading ? (
          <div className="text-gray-400">Loading…</div>
        ) : !runtime ? (
          <h1 className="text-lg font-semibold text-gray-500">{t("detail.notFound")}</h1>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                runtime.online ? "animate-pulse bg-emerald-500" : "bg-gray-400"
              }`}
              aria-label={runtime.online ? t("detail.header.online") : t("detail.header.offline")}
            />
            <h1 className="truncate text-lg font-semibold">{runtime.name}</h1>
            <span
              className={`text-[12px] ${runtime.online ? "text-emerald-600" : "text-gray-400"}`}
            >
              {runtime.online ? t("detail.header.online") : t("detail.header.offline")}
            </span>
            <span className="font-mono text-[12px] text-gray-500">
              {t("detail.header.version")} {runtime.daemonVersion}
            </span>
            {runtime.lastHeartbeatAt && (
              <span className="text-[12px] text-gray-400">
                {t("detail.header.lastSeen")} {new Date(runtime.lastHeartbeatAt).toLocaleString()}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {runtime && (
          <div className="grid max-w-4xl grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <RuntimeStatusCard runtime={runtime} />

              <section className="rounded border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-4 py-2.5">
                  <span className="text-[13px] font-semibold">{t("detail.activity.title")}</span>
                </div>
                <div className="px-4 py-6 text-center text-[13px] text-gray-400">
                  {t("detail.activity.empty")}
                </div>
              </section>

              <section className="rounded border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-4 py-2.5">
                  <span className="text-[13px] font-semibold">{t("detail.usage.title")}</span>
                </div>
                <div className="px-4 py-6 text-center text-[13px] text-gray-400">
                  {t("detail.usage.empty")}
                </div>
              </section>
            </div>

            <RuntimeAgentsList agents={runtimeAgents} workspaceSlug={workspaceSlug} />
          </div>
        )}
      </div>
    </div>
  );
}

"use client";
import {
  type AgentScope,
  type AgentStatusFilter,
  AgentStatusPills,
} from "@/components/agents/AgentStatusPills";
import {
  type AgentRowStatus,
  AgentTable,
  type AgentTableRow,
} from "@/components/agents/AgentTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAgents } from "@/hooks/useAgents";
import { useRuntimes } from "@/hooks/useRuntimes";
import { useWSChannel } from "@/hooks/useWSChannel";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { Runtime, WSMessage } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";

const supabase = createClient();

function statusFromRuntime(runtime: Runtime | undefined | null): AgentRowStatus {
  if (!runtime) return "offline";
  if (!runtime.online) return "offline";
  if (!runtime.lastHeartbeatAt) return "unstable";
  const ageMs = Date.now() - new Date(runtime.lastHeartbeatAt).getTime();
  if (ageMs < 60_000) return "online";
  if (ageMs < 180_000) return "unstable";
  return "offline";
}

export default function AgentsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [scope, setScope] = useState<AgentScope>("mine");
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>("all");
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const t = data.session.access_token;
      setToken(t);
      const [workspaces, me] = await Promise.all([api.listWorkspaces(t), api.getMe(t)]);
      // Use the public.users.id (returned by /api/me), not the supabase auth
      // UUID (data.session.user.id). agents.ownerId references public.users.id;
      // mixing the two breaks every "Mine" filter.
      setUserId((me as { id: string }).id);
      const ws = (workspaces as Array<{ id: string; slug: string }>).find(
        (w) => w.slug === workspaceSlug,
      );
      if (ws) setWorkspaceId(ws.id);
    });
  }, [workspaceSlug]);

  useWSChannel(workspaceId, (msg: WSMessage) => {
    const eventType = msg.event.type;
    if (eventType === "agent.created" || eventType === "agent.updated") {
      qc.invalidateQueries({ queryKey: ["agents", workspaceId] });
    }
    if (eventType === "runtime.online" || eventType === "runtime.offline") {
      qc.invalidateQueries({ queryKey: ["runtimes", workspaceId] });
    }
  });

  const { data: agents = [], isLoading } = useAgents(token, workspaceId);
  const { data: runtimes = [] } = useRuntimes(token, workspaceId);

  const runtimeById = useMemo(() => {
    const map = new Map<string, Runtime>();
    for (const r of runtimes) map.set(r.id, r);
    return map;
  }, [runtimes]);

  const rows: AgentTableRow[] = useMemo(() => {
    return agents.map((a) => {
      const runtime = a.runtimeId ? runtimeById.get(a.runtimeId) : null;
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        runtimeId: a.runtimeId,
        runtimeName: runtime?.name ?? null,
        status: statusFromRuntime(runtime),
        maxConcurrentTasks: a.maxConcurrentTasks,
      };
    });
  }, [agents, runtimeById]);

  const scoped = useMemo(() => {
    if (scope === "mine" && userId) {
      const mineIds = new Set(agents.filter((a) => a.ownerId === userId).map((a) => a.id));
      return rows.filter((r) => mineIds.has(r.id));
    }
    return rows;
  }, [rows, agents, scope, userId]);

  const counts = useMemo(() => {
    const c: Record<AgentStatusFilter, number> = {
      all: scoped.length,
      online: 0,
      unstable: 0,
      offline: 0,
    };
    for (const r of scoped) c[r.status] += 1;
    return c;
  }, [scoped]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return scoped;
    return scoped.filter((r) => r.status === statusFilter);
  }, [scoped, statusFilter]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h1 className="text-lg font-semibold">Agents</h1>
        <Link
          href={`/${workspaceSlug}/agents/new`}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded font-medium"
        >
          + New Agent
        </Link>
      </div>

      <AgentStatusPills
        scope={scope}
        status={statusFilter}
        onScope={setScope}
        onStatus={setStatusFilter}
        counts={counts}
      />

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <EmptyState title="Loading agents..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No agents yet"
            description="Create your first agent to get started."
            cta={{
              label: "Create agent",
              onClick: () => router.push(`/${workspaceSlug}/agents/new`),
            }}
          />
        ) : (
          <AgentTable agents={filtered} workspaceSlug={workspaceSlug} />
        )}
      </div>
    </div>
  );
}

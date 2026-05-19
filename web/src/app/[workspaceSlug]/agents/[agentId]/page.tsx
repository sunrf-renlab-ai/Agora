"use client";
import { AgentForm } from "@/components/agents/AgentForm";
import { AgentSkillsPanel } from "@/components/skills/AgentSkillsPanel";
import { useAgent, useArchiveAgent, useUpdateAgent } from "@/hooks/useAgents";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

const supabase = createClient();

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; agentId: string }>;
}) {
  const { workspaceSlug, agentId } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const router = useRouter();

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

  const { data: agent, isLoading } = useAgent(token, workspaceId, agentId);
  const updateAgent = useUpdateAgent(token, workspaceId);
  const archiveAgent = useArchiveAgent(token, workspaceId);

  async function handleSubmit(data: Record<string, unknown>) {
    await updateAgent.mutateAsync({ id: agentId, data });
    router.push(`/${workspaceSlug}/agents`);
  }

  async function handleArchive() {
    await archiveAgent.mutateAsync(agentId);
    router.push(`/${workspaceSlug}/agents`);
  }

  if (isLoading || !agent) {
    return <div className="p-8 text-gray-400">Loading…</div>;
  }

  return (
    <div className="p-8 max-w-xl">
      <button
        type="button"
        onClick={() => router.push(`/${workspaceSlug}/agents`)}
        className="text-sm text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1"
      >
        ← Back to agents
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{agent.name}</h1>
        {!agent.archivedAt && (
          <button
            type="button"
            onClick={handleArchive}
            disabled={archiveAgent.isPending}
            className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            {archiveAgent.isPending ? "Archiving…" : "Archive"}
          </button>
        )}
      </div>

      {agent.archivedAt && (
        <div className="mb-4 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
          This agent was archived on {new Date(agent.archivedAt).toLocaleDateString()}.
        </div>
      )}

      <AgentForm
        initial={agent}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${workspaceSlug}/agents`)}
        isLoading={updateAgent.isPending}
      />

      <div className="mt-10 border-t pt-6">
        <AgentSkillsPanel token={token} workspaceId={workspaceId} agentId={agentId} />
      </div>
    </div>
  );
}

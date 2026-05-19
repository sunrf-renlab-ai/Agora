"use client";
import { AgentForm } from "@/components/agents/AgentForm";
import { useCreateAgent } from "@/hooks/useAgents";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

const supabase = createClient();

export default function NewAgentPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
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

  const createAgent = useCreateAgent(token, workspaceId);

  async function handleSubmit(data: Record<string, unknown>) {
    await createAgent.mutateAsync(data);
    router.push(`/${workspaceSlug}/agents`);
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
      <h1 className="text-2xl font-bold mb-6">New Agent</h1>
      <AgentForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${workspaceSlug}/agents`)}
        isLoading={createAgent.isPending}
      />
    </div>
  );
}

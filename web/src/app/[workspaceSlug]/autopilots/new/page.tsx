"use client";
import { AutopilotForm } from "@/components/autopilots/AutopilotForm";
import { useCreateAutopilot } from "@/hooks/useAutopilots";
import { ApiError, api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { Autopilot } from "@agora/shared";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

const supabase = createClient();

export default function NewAutopilotPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const createAutopilot = useCreateAutopilot(token, workspaceId);

  async function handleSubmit(data: Record<string, unknown>) {
    setError(null);
    try {
      const created = (await createAutopilot.mutateAsync(data)) as Autopilot;
      router.push(`/${workspaceSlug}/autopilots/${created.id}`);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError("Failed to create autopilot");
    }
  }

  return (
    <div className="p-8 max-w-xl">
      <button
        type="button"
        onClick={() => router.push(`/${workspaceSlug}/autopilots`)}
        className="text-sm text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1"
      >
        ← Back to autopilots
      </button>
      <h1 className="text-2xl font-bold mb-6">New Autopilot</h1>
      <AutopilotForm
        token={token}
        workspaceId={workspaceId}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${workspaceSlug}/autopilots`)}
        isLoading={createAutopilot.isPending}
        error={error}
      />
    </div>
  );
}

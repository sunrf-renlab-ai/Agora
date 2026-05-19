"use client";
import { RuntimeRow } from "@/components/runtimes/RuntimeRow";
import { useDeleteRuntime, useRuntimes } from "@/hooks/useRuntimes";
import { useWSChannel } from "@/hooks/useWSChannel";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { WSMessage } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import { use, useEffect, useState } from "react";

const supabase = createClient();

export default function RuntimesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
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

  useWSChannel(workspaceId, (msg: WSMessage) => {
    const eventType = msg.event.type;
    if (eventType === "runtime.online" || eventType === "runtime.offline") {
      qc.invalidateQueries({ queryKey: ["runtimes", workspaceId] });
    }
  });

  const { data: runtimes = [], isLoading } = useRuntimes(token, workspaceId);
  const deleteRuntime = useDeleteRuntime(token, workspaceId);

  function handleDelete(id: string) {
    deleteRuntime.mutate(id);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h1 className="text-lg font-semibold">Runtimes</h1>
        <span className="text-xs text-gray-400">
          {runtimes.filter((r) => r.online).length} / {runtimes.length} online
        </span>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="text-gray-400">Loading…</div>
        ) : runtimes.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p className="text-lg mb-2">No runtimes registered</p>
            <p className="text-sm">
              Install the Agora daemon on your machine to connect a runtime.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-w-2xl">
            {runtimes.map((runtime) => (
              <RuntimeRow
                key={runtime.id}
                runtime={runtime}
                workspaceSlug={workspaceSlug}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

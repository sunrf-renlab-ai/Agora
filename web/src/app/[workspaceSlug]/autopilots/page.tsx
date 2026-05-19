"use client";
import { AutopilotRow } from "@/components/autopilots/AutopilotRow";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAutopilots } from "@/hooks/useAutopilots";
import { useWSChannel } from "@/hooks/useWSChannel";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { WSMessage } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useEffect, useState } from "react";

const supabase = createClient();

export default function AutopilotsPage({
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
    if (
      eventType === "autopilot.created" ||
      eventType === "autopilot.updated" ||
      eventType === "autopilot.deleted"
    ) {
      qc.invalidateQueries({ queryKey: ["autopilots", workspaceId] });
    }
  });

  const { data: autopilots = [], isLoading } = useAutopilots(token, workspaceId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h1 className="text-lg font-semibold">Autopilots</h1>
        <Link
          href={`/${workspaceSlug}/autopilots/new`}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded font-medium"
        >
          + New Autopilot
        </Link>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : autopilots.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p className="text-lg mb-2">No autopilots yet</p>
            <Link
              href={`/${workspaceSlug}/autopilots/new`}
              className="text-indigo-600 underline text-sm"
            >
              Create your first autopilot
            </Link>
          </div>
        ) : (
          <div className="space-y-2 max-w-2xl">
            {autopilots.map((autopilot) => (
              <AutopilotRow
                key={autopilot.id}
                autopilot={autopilot}
                workspaceSlug={workspaceSlug}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

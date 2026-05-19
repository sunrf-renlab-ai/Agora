"use client";
import { AutopilotForm } from "@/components/autopilots/AutopilotForm";
import { RunRow } from "@/components/autopilots/RunRow";
import { TriggerForm, WebhookTokenBanner } from "@/components/autopilots/TriggerForm";
import { TriggerRow } from "@/components/autopilots/TriggerRow";
import { useAutopilotRuns } from "@/hooks/useAutopilotRuns";
import { useCreateTrigger, useDeleteTrigger, useUpdateTrigger } from "@/hooks/useAutopilotTriggers";
import {
  useAutopilot,
  useDeleteAutopilot,
  useManualTriggerAutopilot,
  useUpdateAutopilot,
} from "@/hooks/useAutopilots";
import { useWSChannel } from "@/hooks/useWSChannel";
import { ApiError, api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { WSMessage } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

const supabase = createClient();

export default function AutopilotDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; autopilotId: string }>;
}) {
  const { workspaceSlug, autopilotId } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [showTriggerForm, setShowTriggerForm] = useState(false);
  const [webhookCleartext, setWebhookCleartext] = useState<string | null>(null);
  const router = useRouter();
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
    if (eventType === "autopilot.run.start" || eventType === "autopilot.run.done") {
      const data = msg.event.data;
      if ("autopilotId" in data && data.autopilotId === autopilotId) {
        qc.invalidateQueries({ queryKey: ["autopilot-runs", workspaceId, autopilotId] });
        qc.invalidateQueries({ queryKey: ["autopilot", workspaceId, autopilotId] });
      }
    }
  });

  const { data: detail, isLoading } = useAutopilot(token, workspaceId, autopilotId);
  const { data: runs = [] } = useAutopilotRuns(token, workspaceId, autopilotId);
  const updateAutopilot = useUpdateAutopilot(token, workspaceId);
  const deleteAutopilot = useDeleteAutopilot(token, workspaceId);
  const manualTrigger = useManualTriggerAutopilot(token, workspaceId);
  const createTrigger = useCreateTrigger(token, workspaceId, autopilotId);
  const updateTrigger = useUpdateTrigger(token, workspaceId, autopilotId);
  const deleteTrigger = useDeleteTrigger(token, workspaceId, autopilotId);

  async function handleSave(data: Record<string, unknown>) {
    setUpdateError(null);
    try {
      await updateAutopilot.mutateAsync({ id: autopilotId, data });
    } catch (e) {
      if (e instanceof ApiError) setUpdateError(e.message);
      else setUpdateError("Failed to update autopilot");
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this autopilot? This cannot be undone.")) return;
    await deleteAutopilot.mutateAsync(autopilotId);
    router.push(`/${workspaceSlug}/autopilots`);
  }

  async function handleRunNow() {
    setUpdateError(null);
    try {
      await manualTrigger.mutateAsync(autopilotId);
    } catch (e) {
      if (e instanceof ApiError) setUpdateError(e.message);
      else setUpdateError("Failed to trigger run");
    }
  }

  async function handleCreateTrigger(data: Record<string, unknown>) {
    setTriggerError(null);
    try {
      const created = (await createTrigger.mutateAsync(data)) as {
        webhookToken?: string;
      };
      setShowTriggerForm(false);
      if (created.webhookToken) {
        setWebhookCleartext(created.webhookToken);
      }
    } catch (e) {
      if (e instanceof ApiError) setTriggerError(e.message);
      else setTriggerError("Failed to create trigger");
    }
  }

  async function handleToggleTrigger(triggerId: string, enabled: boolean) {
    await updateTrigger.mutateAsync({ triggerId, data: { enabled } });
  }

  async function handleDeleteTrigger(triggerId: string) {
    if (!confirm("Delete this trigger?")) return;
    await deleteTrigger.mutateAsync(triggerId);
  }

  if (isLoading || !detail) {
    return <div className="p-8 text-gray-400">Loading…</div>;
  }

  const { autopilot, triggers } = detail;
  const visibleRuns = runs.slice(0, 20);

  return (
    <div className="p-8 max-w-2xl space-y-8">
      <button
        type="button"
        onClick={() => router.push(`/${workspaceSlug}/autopilots`)}
        className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1"
      >
        ← Back to autopilots
      </button>

      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{autopilot.title}</h1>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRunNow}
              disabled={manualTrigger.isPending}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded font-medium disabled:opacity-60"
            >
              {manualTrigger.isPending ? "Running…" : "Run now"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteAutopilot.isPending}
              className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              {deleteAutopilot.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>

        <AutopilotForm
          initial={autopilot}
          token={token}
          workspaceId={workspaceId}
          onSubmit={handleSave}
          isLoading={updateAutopilot.isPending}
          error={updateError}
        />
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Triggers</h2>
          {!showTriggerForm && (
            <button
              type="button"
              onClick={() => {
                setShowTriggerForm(true);
                setTriggerError(null);
              }}
              className="text-sm text-indigo-600 underline"
            >
              + Add trigger
            </button>
          )}
        </div>

        {webhookCleartext && (
          <div className="mb-4">
            <WebhookTokenBanner
              cleartext={webhookCleartext}
              onDismiss={() => setWebhookCleartext(null)}
            />
          </div>
        )}

        {showTriggerForm && (
          <div className="border rounded p-4 mb-4 bg-gray-50">
            <TriggerForm
              onSubmit={handleCreateTrigger}
              onCancel={() => {
                setShowTriggerForm(false);
                setTriggerError(null);
              }}
              isLoading={createTrigger.isPending}
              error={triggerError}
            />
          </div>
        )}

        {triggers.length === 0 && !showTriggerForm ? (
          <div className="text-sm text-gray-400">No triggers configured.</div>
        ) : (
          <div className="space-y-2">
            {triggers.map((t) => (
              <TriggerRow
                key={t.id}
                trigger={t}
                onDelete={handleDeleteTrigger}
                onToggle={handleToggleTrigger}
                isPending={updateTrigger.isPending || deleteTrigger.isPending}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Run history</h2>
        {visibleRuns.length === 0 ? (
          <div className="text-sm text-gray-400">No runs yet.</div>
        ) : (
          <div className="space-y-2">
            {visibleRuns.map((run) => (
              <RunRow key={run.id} run={run} workspaceSlug={workspaceSlug} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

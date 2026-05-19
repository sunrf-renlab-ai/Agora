"use client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import {
  useDisconnect,
  useMyConnections,
  useStartConnection,
} from "@/hooks/useConnections";
import { useRuntimes } from "@/hooks/useRuntimes";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import {
  CLI_INSTALL_HINTS,
  CLI_KINDS,
  CLI_LABELS,
  CONNECTION_KINDS,
  type CliKind,
  type ConnectionKind,
  type ConnectionStatus,
  type Runtime,
} from "@agora/shared";
import {
  Check,
  Cpu,
  FileText,
  Github,
  Link as LinkIcon,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const supabase = createClient();

const CONN_LABEL: Record<ConnectionKind, string> = {
  linear: "Linear",
  github: "GitHub",
  notion: "Notion",
  slack: "Slack",
};
const CONN_DESCRIPTION: Record<ConnectionKind, string> = {
  linear: "Pull issue context, projects, status from your Linear workspace.",
  github: "Read repo metadata, PRs, and your profile.",
  notion: "Access pages and databases in a Notion workspace.",
  slack: "Read your channels and basic profile info.",
};
const CONN_ICON: Record<ConnectionKind, React.ComponentType<{ className?: string }>> = {
  linear: LinkIcon,
  github: Github,
  notion: FileText,
  slack: MessageSquare,
};

/**
 * Personal connections settings. The user manages their own OAuth
 * data sources here; the read-only team aggregate lives on
 * /knowledge so everyone in the workspace can see who is wired to
 * what without seeing each other's tokens.
 */
export default function ConnectionsSettingsPage() {
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [pendingNotConfigured, setPendingNotConfigured] = useState<ConnectionKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async (r) => {
      if (cancelled) return;
      const tk = r.data.session?.access_token ?? null;
      setToken(tk);
      if (tk) {
        try {
          const ws = (await api.listWorkspaces(tk)) as Array<{ id: string }>;
          if (!cancelled && ws.length > 0 && ws[0]) setWorkspaceId(ws[0].id);
        } catch {}
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const conns = useMyConnections(token);
  const startConn = useStartConnection(token);
  const disconnect = useDisconnect(token);
  const { data: runtimes = [] as Runtime[] } = useRuntimes(token, workspaceId);

  // Aggregate detected CLIs across all online runtimes — used to flag
  // which local CLIs Agora can actually launch in this workspace today.
  const detectedKinds = useMemo(() => {
    const set = new Set<string>();
    for (const r of runtimes) {
      if (!r.online) continue;
      for (const c of r.detectedClis ?? []) set.add(c.kind);
    }
    return set;
  }, [runtimes]);

  const statusByKind = useMemo(() => {
    const m = new Map<ConnectionKind, ConnectionStatus>();
    for (const k of CONNECTION_KINDS) m.set(k, "pending");
    for (const c of conns.data?.kinds ?? []) m.set(c.kind, c.status);
    return m;
  }, [conns.data]);

  return (
    <div className="min-h-full bg-canvas">
      <PageHeader
        eyebrow="Settings"
        title="My connections"
        subtitle="Personal data sources for your agents to read. Only you can manage these — your team sees a read-only summary on the Knowledge page."
      />
      <div className="p-8 max-w-2xl">
        <h2 className="text-[13px] font-medium text-gray-500 uppercase tracking-wide mb-3">
          Local AI agents
        </h2>
        <p className="text-[12px] text-gray-500 mb-3 leading-relaxed">
          Agora supports {CLI_KINDS.length} local coding-agent CLIs. Install one on a machine
          that runs <code className="font-mono bg-gray-100 rounded px-1">agorad</code>; the
          daemon auto-detects them on startup.
        </p>
        <ul className="space-y-2 mb-8">
          {CLI_KINDS.map((kind: CliKind) => {
            const detected = detectedKinds.has(kind);
            return (
              <li
                key={kind}
                className="bg-white rounded-md border border-gray-200 px-4 py-3 flex items-center gap-3"
              >
                <span
                  className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${
                    detected ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {detected ? <Check className="w-4 h-4" /> : <Cpu className="w-4 h-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-gray-900">
                    {CLI_LABELS[kind]}
                  </span>
                  <span className="block text-[12px] text-gray-500 leading-relaxed">
                    {detected ? "Detected on an online runtime" : CLI_INSTALL_HINTS[kind]}
                  </span>
                </span>
                <span
                  className={`text-[11px] uppercase tracking-wide ${
                    detected ? "text-emerald-600" : "text-gray-400"
                  }`}
                >
                  {detected ? "Available" : "Not installed"}
                </span>
              </li>
            );
          })}
        </ul>

        <h2 className="text-[13px] font-medium text-gray-500 uppercase tracking-wide mb-3">
          Personal data sources
        </h2>
        {conns.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <ul className="space-y-2">
            {CONNECTION_KINDS.map((kind) => {
              const Icon = CONN_ICON[kind];
              const status = statusByKind.get(kind) ?? "pending";
              const connected = status === "connected";
              return (
                <li
                  key={kind}
                  className="bg-white rounded-md border border-gray-200 px-4 py-3 hover:border-gray-300 transition-colors flex items-center gap-3"
                >
                  <span
                    className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${
                      connected
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {connected ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-gray-900">
                      {CONN_LABEL[kind]}
                    </span>
                    <span className="block text-[12px] text-gray-500 leading-relaxed">
                      {connected ? "Connected" : CONN_DESCRIPTION[kind]}
                    </span>
                  </span>
                  {connected ? (
                    <button
                      type="button"
                      disabled={disconnect.isPending}
                      onClick={() => disconnect.mutate(kind)}
                      className="px-3 py-1.5 text-[12px] text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={startConn.isPending}
                      onClick={async () => {
                        try {
                          const r = await startConn.mutateAsync(kind);
                          if ("notConfigured" in r) {
                            setPendingNotConfigured(kind);
                          } else {
                            window.location.href = r.authorizeUrl;
                          }
                        } catch (e) {
                          toast(e instanceof Error ? e.message : "Connect failed", "error");
                        }
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium transition-all active:scale-[0.97] disabled:bg-gray-200"
                    >
                      {startConn.isPending && startConn.variables === kind && (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      )}
                      Connect
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {pendingNotConfigured && (
        <div
          className="fixed inset-0 z-50 bg-gray-900/30 backdrop-blur-[1.5px] flex items-center justify-center p-6 agora-fade-in"
          onClick={() => setPendingNotConfigured(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPendingNotConfigured(null);
          }}
          role="presentation"
        >
          <div
            className="bg-white rounded-lg border border-gray-200 shadow-xl p-6 max-w-md w-full agora-fade-in-up"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-[16px] font-semibold text-gray-900 mb-1.5">
              Connect {CONN_LABEL[pendingNotConfigured]}
            </h3>
            <p className="text-[13px] text-gray-600 leading-relaxed">
              The OAuth app for {CONN_LABEL[pendingNotConfigured]} hasn't been configured yet
              by the workspace admin. See{" "}
              <code className="font-mono text-[12px] bg-gray-100 rounded px-1 py-0.5">
                docs/oauth-connections.md
              </code>{" "}
              for the env vars to set on the server, then redeploy and try again.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingNotConfigured(null)}
                className="px-3.5 py-1.5 text-[13px] text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

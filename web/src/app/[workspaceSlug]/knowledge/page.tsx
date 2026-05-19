"use client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useWorkspaceConnections } from "@/hooks/useConnections";
import { useKnowledgeDocs } from "@/hooks/useKnowledge";
import { useProjects } from "@/hooks/useProjects";
import { useSkills } from "@/hooks/useSkills";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import {
  CONNECTION_KINDS,
  type ConnectionKind,
  KNOWLEDGE_KINDS,
  type KnowledgeKind,
} from "@agora/shared";
import {
  Boxes,
  Check,
  Clock,
  FileText,
  Github,
  HelpCircle,
  Library,
  Lightbulb,
  Link as LinkIcon,
  MessageSquare,
  Plus,
  Search,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";

const supabase = createClient();

const KIND_LABEL: Record<KnowledgeKind, string> = {
  general: "General",
  faq: "FAQ",
  decision: "Decisions",
  runbook: "Runbooks",
  onboarding: "Onboarding",
};

const KIND_ICON: Record<KnowledgeKind, React.ComponentType<{ className?: string }>> = {
  general: FileText,
  faq: HelpCircle,
  decision: Lightbulb,
  runbook: Wrench,
  onboarding: Boxes,
};

const CONN_LABEL: Record<ConnectionKind, string> = {
  linear: "Linear",
  github: "GitHub",
  notion: "Notion",
  slack: "Slack",
};
const CONN_ICON: Record<ConnectionKind, React.ComponentType<{ className?: string }>> = {
  linear: LinkIcon,
  github: Github,
  notion: FileText,
  slack: MessageSquare,
};

export default function KnowledgePage({
  params,
}: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { toast } = useToast();

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

  // OAuth callback flash. The /__connection-callback page parks a
  // breadcrumb in sessionStorage so we can toast on this page (where
  // the user expected to land), regardless of how Next.js's router
  // replays the redirect.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem("agora.connectionFlash");
    } catch {
      return;
    }
    if (!raw) return;
    try {
      sessionStorage.removeItem("agora.connectionFlash");
      const flash = JSON.parse(raw) as {
        kind: string;
        status: string;
        reason: string;
        at: number;
      };
      if (Date.now() - flash.at > 60_000) return; // stale, ignore
      if (flash.status === "connected") {
        toast(`Connected ${flash.kind}.`, "success");
      } else {
        toast(
          `Couldn't connect ${flash.kind}${flash.reason ? `: ${flash.reason}` : ""}`,
          "error",
        );
      }
    } catch {
      // malformed flash — ignore
    }
  }, [toast]);

  const docs = useKnowledgeDocs(token, workspaceId);
  const skills = useSkills(token, workspaceId);
  const projects = useProjects(token, workspaceId);
  const teamConns = useWorkspaceConnections(token, workspaceId);

  // Aggregate "how many members in this workspace have <kind> connected".
  // Drives the team-data-sources panel below — we surface counts (not
  // individual users) so the panel reads at a glance and there's no
  // accidental implication of seeing each other's tokens.
  const connectedCounts = useMemo(() => {
    const m = new Map<ConnectionKind, number>();
    for (const k of CONNECTION_KINDS) m.set(k, 0);
    for (const member of teamConns.data?.members ?? []) {
      for (const c of member.connections) {
        if (c.status === "connected") m.set(c.kind, (m.get(c.kind) ?? 0) + 1);
      }
    }
    return m;
  }, [teamConns.data]);
  const totalMembers = teamConns.data?.members.length ?? 0;

  // Client-side search: substring match against title + content. Cheap
  // for the doc counts a workspace realistically holds (low hundreds).
  // When this stops scaling we'll move to pg_trgm or pgvector — until
  // then, this is one fewer round-trip + works against the same query
  // cache as the unfiltered list.
  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = docs.data ?? [];
    if (!q) return all;
    return all.filter(
      (d) => d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q),
    );
  }, [docs.data, query]);

  // Group docs by scope (workspace-wide first, then one section per
  // project). The kind sub-grouping is dropped at the page level —
  // showing kinds + projects two-deep makes a busy page busier; the
  // kind icon on each row carries the same info inline. The detail
  // page still kind-groups when there are enough docs to warrant it.
  const projectsById = useMemo(() => {
    const m = new Map<string, { id: string; title: string }>();
    for (const p of projects.data ?? []) m.set(p.id, { id: p.id, title: p.title });
    return m;
  }, [projects.data]);

  type Group = { key: string; label: string; projectId: string | null; docs: typeof filteredDocs };
  const groups: Group[] = useMemo(() => {
    // Buckets: one for workspace-wide + one per project that has docs.
    // Empty project buckets are hidden.
    const byProject = new Map<string | null, typeof filteredDocs>();
    for (const d of filteredDocs) {
      const k = d.projectId;
      if (!byProject.has(k)) byProject.set(k, []);
      byProject.get(k)!.push(d);
    }
    const out: Group[] = [];
    if (byProject.has(null)) {
      out.push({
        key: "ws",
        label: "Workspace-wide",
        projectId: null,
        docs: byProject.get(null) ?? [],
      });
    }
    // Sort project sections by their most-recently-updated doc.
    const projectKeys = [...byProject.keys()].filter((k): k is string => k !== null);
    projectKeys.sort((a, b) => {
      const aMax = (byProject.get(a) ?? []).reduce((m, d) => Math.max(m, +new Date(d.updatedAt)), 0);
      const bMax = (byProject.get(b) ?? []).reduce((m, d) => Math.max(m, +new Date(d.updatedAt)), 0);
      return bMax - aMax;
    });
    for (const pid of projectKeys) {
      const meta = projectsById.get(pid);
      out.push({
        key: pid,
        label: meta?.title ?? "(deleted project)",
        projectId: pid,
        docs: byProject.get(pid) ?? [],
      });
    }
    return out;
  }, [filteredDocs, projectsById]);

  const recentSkills = (skills.data ?? []).slice(0, 3);

  return (
    <div className="min-h-full bg-canvas">
      <PageHeader
        eyebrow="Workspace"
        title="Knowledge"
        subtitle="Skills, shared docs, and team data sources — everything below is org-shared, every workspace member sees the same."
        actions={
          <Link
            href={`/${workspaceSlug}/knowledge/new`}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium transition-all active:scale-[0.97]"
          >
            <Plus className="w-3.5 h-3.5" /> New doc
          </Link>
        }
      />

      <div className="p-8 max-w-5xl mx-auto space-y-10">
        {/* ─── Skills ─────────────────────────────── */}
        <section className="agora-fade-in-up">
          <SectionHeader
            icon={<Wrench className="w-4 h-4" />}
            title="Skills"
            count={skills.data?.length}
            action={
              <Link
                href={`/${workspaceSlug}/skills`}
                className="text-[12px] text-indigo-700 hover:underline"
              >
                Browse all →
              </Link>
            }
          />
          {skills.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : recentSkills.length === 0 ? (
            <div className="text-[13px] text-gray-500">
              No skills yet.{" "}
              <Link
                href={`/${workspaceSlug}/skills`}
                className="text-indigo-700 hover:underline"
              >
                Import or create one
              </Link>
              .
            </div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {recentSkills.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/${workspaceSlug}/skills/${s.id}`}
                    className="block bg-white rounded-md border border-gray-200 px-3 py-2.5 hover:border-gray-300 hover:shadow-[0_2px_6px_rgba(0,0,0,0.04)] transition-all"
                  >
                    <div className="text-[13px] font-medium text-gray-900 truncate">{s.name}</div>
                    {s.description && (
                      <div className="text-[12px] text-gray-500 truncate mt-0.5">
                        {s.description}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ─── Workspace Docs ────────────────────── */}
        <section className="agora-fade-in-up" style={{ animationDelay: "60ms" }}>
          <SectionHeader
            icon={<Library className="w-4 h-4" />}
            title="Workspace knowledge"
            count={docs.data?.length}
            action={
              (docs.data?.length ?? 0) > 0 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search docs…"
                    className="bg-white border border-gray-200 rounded-md pl-8 pr-3 py-1.5 text-[12px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-300 focus:shadow-[0_0_0_3px_oklch(0.93_0.04_255_/_0.6)] transition-shadow w-48"
                  />
                </div>
              )
            }
          />
          {docs.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-2/3" />
            </div>
          ) : query && filteredDocs.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 bg-white py-8 text-center">
              <p className="text-[13px] text-gray-700 font-medium">No docs match "{query}"</p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-2 text-[12px] text-indigo-700 hover:underline"
              >
                Clear search
              </button>
            </div>
          ) : (docs.data?.length ?? 0) === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 bg-white py-10 text-center">
              <Library className="w-6 h-6 text-gray-300 mx-auto mb-3" />
              <p className="text-[13px] text-gray-700 font-medium">No docs yet</p>
              <p className="text-[12px] text-gray-500 mt-1">
                Capture FAQs, runbooks, decisions — anything the team should remember.
              </p>
              <Link
                href={`/${workspaceSlug}/knowledge/new`}
                className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 text-[12px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium transition-all active:scale-[0.97]"
              >
                <Plus className="w-3 h-3" /> Add your first doc
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <div key={g.key}>
                  <p className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-gray-500 font-semibold mb-2 px-1">
                    <span className="flex items-center gap-1.5">
                      {g.projectId === null ? (
                        <Library className="w-3 h-3 text-gray-500" />
                      ) : (
                        <Boxes className="w-3 h-3 text-indigo-500" />
                      )}
                      {g.projectId === null ? "Workspace-wide" : `Project · ${g.label}`}
                    </span>
                    <span className="font-display italic text-[11px] text-gray-400 tabular-nums normal-case tracking-normal">
                      {g.docs.length}
                    </span>
                  </p>
                  <ul className="divide-y divide-gray-100 rounded-md border border-gray-200/70 bg-white">
                    {g.docs.map((d) => {
                      const Icon = KIND_ICON[d.kind];
                      return (
                        <li key={d.id}>
                          <Link
                            href={`/${workspaceSlug}/knowledge/${d.id}`}
                            className="group flex items-center gap-3 px-3.5 py-2.5 text-[13px] text-gray-800 hover:bg-gray-50 first:rounded-t-md last:rounded-b-md transition-colors"
                          >
                            <Icon
                              className="w-3.5 h-3.5 text-gray-400 group-hover:text-indigo-600 shrink-0 transition-colors"
                              aria-label={KIND_LABEL[d.kind]}
                            />
                            <span className="truncate flex-1 group-hover:text-gray-900">
                              {d.title}
                            </span>
                            <span className="font-display italic text-[11px] text-gray-400 tabular-nums shrink-0 inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {relativeTime(d.updatedAt)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── Team data sources ───────────────────
            Read-only aggregate — shows how many teammates have wired
            up each provider. The personal Connect / Disconnect lives
            in /settings/connections; this panel intentionally never
            surfaces individual people's tokens. */}
        <section className="agora-fade-in-up" style={{ animationDelay: "120ms" }}>
          <SectionHeader
            icon={<LinkIcon className="w-4 h-4" />}
            title="Team data sources"
            subtitle={`Workspace coverage across ${totalMembers || "—"} member${totalMembers === 1 ? "" : "s"}. Manage your own connections in `}
            action={
              <Link
                href={`/${workspaceSlug}/settings/connections`}
                className="text-[12px] text-indigo-700 hover:underline"
              >
                Settings →
              </Link>
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CONNECTION_KINDS.map((kind) => {
              const Icon = CONN_ICON[kind];
              const count = connectedCounts.get(kind) ?? 0;
              const live = count > 0;
              return (
                <div
                  key={kind}
                  className="bg-white rounded-md border border-gray-200 px-3.5 py-3 flex items-center gap-3"
                >
                  <span
                    className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                      live ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-gray-900">
                      {CONN_LABEL[kind]}
                    </span>
                    <span className="block text-[11px] text-gray-500">
                      {live
                        ? `${count} member${count === 1 ? "" : "s"} connected`
                        : "No one connected yet"}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  count,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-gray-900">
          <span className="text-indigo-600">{icon}</span>
          {title}
          {count !== undefined && (
            <span className="font-display italic text-[13px] text-gray-400 tabular-nums">
              {count}
            </span>
          )}
        </h2>
        {subtitle && <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

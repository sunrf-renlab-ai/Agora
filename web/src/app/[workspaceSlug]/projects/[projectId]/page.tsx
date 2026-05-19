"use client";
import { KanbanBoard } from "@/components/issues/KanbanBoard";
import { ProjectForm } from "@/components/projects/ProjectForm";
import { ResourceForm } from "@/components/projects/ResourceForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useIssues } from "@/hooks/useIssues";
import { useKnowledgeDocs } from "@/hooks/useKnowledge";
import {
  useAddProjectResource,
  useDeleteProject,
  useProject,
  useRemoveProjectResource,
  useUpdateProject,
} from "@/hooks/useProjects";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { KNOWLEDGE_KINDS, type KnowledgeKind } from "@agora/shared";
import {
  Boxes,
  Clock,
  FileText,
  HelpCircle,
  KanbanSquare,
  Library,
  Lightbulb,
  Plus,
  Settings,
  Trash2,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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

type Tab = "issues" | "knowledge" | "settings";
const VALID_TABS: ReadonlySet<Tab> = new Set(["issues", "knowledge", "settings"]);

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const tabParam = search.get("tab");
  const tab: Tab = tabParam && VALID_TABS.has(tabParam as Tab) ? (tabParam as Tab) : "issues";

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

  const { data: project, isLoading } = useProject(token, workspaceId, projectId);
  const updateProject = useUpdateProject(token, workspaceId);
  const deleteProject = useDeleteProject(token, workspaceId);
  const addResource = useAddProjectResource(token, workspaceId, projectId);
  const removeResource = useRemoveProjectResource(token, workspaceId, projectId);

  const issuesQ = useIssues(token, workspaceId, undefined, undefined, projectId);
  const docsQ = useKnowledgeDocs(token, workspaceId, projectId);

  function setTab(next: Tab) {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/${workspaceSlug}/projects/${projectId}?${sp.toString()}`);
  }

  async function handleDelete() {
    if (!confirm("Delete this project? Resources + project-scoped knowledge docs will also be removed.")) return;
    await deleteProject.mutateAsync(projectId);
    router.push(`/${workspaceSlug}/projects`);
  }

  if (isLoading || !project) {
    return (
      <div>
        <PageHeader eyebrow="Project" title={<Skeleton className="h-7 w-48" />} />
        <div className="p-8 max-w-3xl space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }

  // Split docs by scope so the Knowledge tab can show "this project"
  // first and "workspace-wide (visible everywhere)" below.
  const projectDocs = (docsQ.data ?? []).filter((d) => d.projectId === projectId);
  const workspaceDocs = (docsQ.data ?? []).filter((d) => d.projectId === null);

  return (
    <div className="min-h-full bg-canvas">
      <PageHeader
        eyebrow="Project"
        title={project.title}
        subtitle={project.description ?? undefined}
        actions={
          <Link
            href={`/${workspaceSlug}/projects`}
            className="text-[12px] text-gray-500 hover:text-gray-900"
          >
            ← All projects
          </Link>
        }
      />

      <nav className="flex gap-1 px-8 border-b border-gray-200 bg-white">
        {(
          [
            ["issues", "Issues", KanbanSquare, issuesQ.data?.length ?? 0],
            ["knowledge", "Knowledge", Library, projectDocs.length],
            ["settings", "Settings", Settings, undefined],
          ] as Array<[Tab, string, typeof KanbanSquare, number | undefined]>
        ).map(([id, label, Icon, count]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={active}
              className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[13px] transition-colors ${
                active
                  ? "text-gray-900 font-medium"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? "text-indigo-600" : "text-gray-400"}`} />
              {label}
              {count !== undefined && (
                <span className="font-display italic text-[12px] text-gray-400 tabular-nums">
                  {count}
                </span>
              )}
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 right-0 -bottom-px h-[2px] bg-indigo-600"
                />
              )}
            </button>
          );
        })}
      </nav>

      {tab === "issues" && (
        <div className="agora-fade-in">
          {issuesQ.isLoading ? (
            <div className="p-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Skeleton.Card />
              <Skeleton.Card />
              <Skeleton.Card />
            </div>
          ) : (issuesQ.data?.length ?? 0) === 0 ? (
            <div className="p-12 text-center">
              <p className="text-[14px] text-gray-700 font-medium">No issues in this project yet.</p>
              <p className="text-[12px] text-gray-500 mt-1">
                Use the global "+ New Issue" button and pick this project as the parent.
              </p>
            </div>
          ) : (
            <KanbanBoard
              issues={issuesQ.data ?? []}
              workspaceSlug={workspaceSlug}
              token={token}
              workspaceId={workspaceId}
            />
          )}
        </div>
      )}

      {tab === "knowledge" && (
        <div className="p-8 max-w-4xl mx-auto agora-fade-in space-y-8">
          <header className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-semibold text-gray-900 mb-1">
                Project knowledge
              </h2>
              <p className="text-[13px] text-gray-500">
                Docs visible inside this project. Workspace-wide docs are also injected into
                the agent's context for tasks on this project.
              </p>
            </div>
            <Link
              href={`/${workspaceSlug}/knowledge/new?projectId=${projectId}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium transition-all active:scale-[0.97]"
            >
              <Plus className="w-3.5 h-3.5" /> New doc
            </Link>
          </header>

          <ScopedDocs
            label="In this project"
            docs={projectDocs}
            workspaceSlug={workspaceSlug}
            isLoading={docsQ.isLoading}
            emptyHint="No project-scoped docs yet. New doc → kind + content; the project link is auto-set."
          />

          <ScopedDocs
            label="Workspace-wide (also visible here)"
            docs={workspaceDocs}
            workspaceSlug={workspaceSlug}
            isLoading={docsQ.isLoading}
            emptyHint="No workspace-wide docs."
            muted
          />
        </div>
      )}

      {tab === "settings" && (
        <div className="p-8 max-w-3xl mx-auto agora-fade-in space-y-8">
          <section>
            <h2 className="text-[15px] font-semibold mb-3">Details</h2>
            <ProjectForm
              initial={project}
              onSubmit={async (data) => {
                try {
                  await updateProject.mutateAsync({ id: projectId, data });
                  toast("Saved.", "success");
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Save failed", "error");
                }
              }}
              isLoading={updateProject.isPending}
              error={null}
            />
          </section>

          <section>
            <h2 className="text-[15px] font-semibold mb-3">Resources</h2>
            <div className="space-y-2 mb-3">
              {project.resources.length === 0 ? (
                <div className="text-[13px] text-gray-500">No resources linked yet.</div>
              ) : (
                project.resources.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-md border border-gray-200 bg-white p-3 hover:border-gray-300 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-gray-900 truncate">
                        {r.label || String(r.resourceRef)}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {r.resourceType} · {String(r.resourceRef)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeResource.mutate(r.id)}
                      disabled={removeResource.isPending}
                      className="text-[11px] text-gray-500 hover:text-red-600 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            <ResourceForm
              onSubmit={async (data) => {
                await addResource.mutateAsync(data);
              }}
              isLoading={addResource.isPending}
              error={addResource.isError ? (addResource.error as Error).message : null}
            />
          </section>

          <section className="pt-6 border-t border-gray-200">
            <h2 className="text-[15px] font-semibold mb-2 text-red-700">Danger zone</h2>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteProject.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleteProject.isPending ? "Deleting…" : "Delete project"}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function ScopedDocs({
  label,
  docs,
  workspaceSlug,
  isLoading,
  emptyHint,
  muted,
}: {
  label: string;
  docs: { id: string; kind: KnowledgeKind; title: string; updatedAt: string }[];
  workspaceSlug: string;
  isLoading: boolean;
  emptyHint: string;
  muted?: boolean;
}) {
  if (isLoading) {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500 font-semibold mb-2">
          {label}
        </p>
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500 font-semibold mb-2">
        {label}
        <span className="font-display italic text-[12px] text-gray-400 tabular-nums ml-2 normal-case tracking-normal">
          {docs.length}
        </span>
      </p>
      {docs.length === 0 ? (
        <p className="text-[12px] text-gray-400 italic">{emptyHint}</p>
      ) : (
        <div className="space-y-3">
          {KNOWLEDGE_KINDS.map((kind) => {
            const items = docs.filter((d) => d.kind === kind);
            if (items.length === 0) return null;
            const Icon = KIND_ICON[kind];
            return (
              <div key={kind}>
                <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">
                  <Icon className="w-3 h-3" /> {KIND_LABEL[kind]}
                </p>
                <ul
                  className={`divide-y divide-gray-100 rounded-md border bg-white ${
                    muted ? "border-gray-200/60 bg-white/60" : "border-gray-200/70"
                  }`}
                >
                  {items.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/${workspaceSlug}/knowledge/${d.id}`}
                        className="group flex items-center gap-3 px-3.5 py-2.5 text-[13px] text-gray-800 hover:bg-gray-50 first:rounded-t-md last:rounded-b-md transition-colors"
                      >
                        <span className="truncate flex-1">{d.title}</span>
                        <span className="font-display italic text-[11px] text-gray-400 tabular-nums shrink-0 inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {relativeTime(d.updatedAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
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

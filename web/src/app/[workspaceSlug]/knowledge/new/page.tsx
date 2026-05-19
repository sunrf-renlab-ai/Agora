"use client";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { useCreateKnowledge } from "@/hooks/useKnowledge";
import { useProjects } from "@/hooks/useProjects";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { KNOWLEDGE_KINDS, type KnowledgeKind } from "@agora/shared";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useEffect, useState } from "react";

const supabase = createClient();

const KIND_LABEL: Record<KnowledgeKind, string> = {
  general: "General",
  faq: "FAQ",
  decision: "Decision",
  runbook: "Runbook",
  onboarding: "Onboarding",
};

export default function NewKnowledgePage({
  params,
}: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [kind, setKind] = useState<KnowledgeKind>("general");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Scope: "" = workspace-wide; otherwise a project id. Pre-fill from
  // ?projectId=… so the project detail page's "+ New doc" link drops
  // the user into a form that's already scoped correctly.
  const [scope, setScope] = useState<string>(() => search.get("projectId") ?? "");

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

  const create = useCreateKnowledge(token, workspaceId);
  const { data: projects = [] } = useProjects(token, workspaceId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const d = await create.mutateAsync({
        kind,
        title: title.trim(),
        content,
        projectId: scope || null,
      });
      router.push(`/${workspaceSlug}/knowledge/${d.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to create", "error");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-full bg-canvas">
      <PageHeader
        eyebrow="Knowledge"
        title="New doc"
        actions={
          <Link
            href={`/${workspaceSlug}/knowledge`}
            className="px-3.5 py-1.5 text-[13px] text-gray-700 hover:text-gray-900 hover:bg-gray-50 border border-gray-200 rounded-md transition-colors"
          >
            Cancel
          </Link>
        }
      />
      <form onSubmit={submit} className="p-8 max-w-3xl mx-auto space-y-5 agora-fade-in-up">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="kb-kind"
              className="block text-[11px] uppercase tracking-[0.16em] text-gray-500 font-semibold mb-1.5"
            >
              Kind
            </label>
            <select
              id="kb-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as KnowledgeKind)}
              className="w-full bg-white border border-gray-200 rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-indigo-300"
            >
              {KNOWLEDGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="kb-scope"
              className="block text-[11px] uppercase tracking-[0.16em] text-gray-500 font-semibold mb-1.5"
            >
              Scope
            </label>
            <select
              id="kb-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-indigo-300"
            >
              <option value="">Workspace-wide (everyone sees it)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  Project: {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label
            htmlFor="kb-title"
            className="block text-[11px] uppercase tracking-[0.16em] text-gray-500 font-semibold mb-1.5"
          >
            Title
          </label>
          <input
            id="kb-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is this about?"
            required
            maxLength={200}
            autoFocus
            className="w-full bg-white border border-gray-200 rounded-md px-3 py-2 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-300 focus:shadow-[0_0_0_3px_oklch(0.93_0.04_255_/_0.6)] transition-shadow"
          />
        </div>
        <div>
          <label
            htmlFor="kb-content"
            className="block text-[11px] uppercase tracking-[0.16em] text-gray-500 font-semibold mb-1.5"
          >
            Content
          </label>
          <textarea
            id="kb-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Markdown supported."
            rows={14}
            className="w-full bg-white border border-gray-200 rounded-md px-3 py-2 text-[13px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-300 focus:shadow-[0_0_0_3px_oklch(0.93_0.04_255_/_0.6)] transition-shadow font-mono"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Link
            href={`/${workspaceSlug}/knowledge`}
            className="px-3.5 py-1.5 text-[13px] text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium transition-all active:scale-[0.97] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

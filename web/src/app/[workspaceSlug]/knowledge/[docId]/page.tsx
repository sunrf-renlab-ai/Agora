"use client";
import { Markdown } from "@/components/ui/Markdown";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import {
  useDeleteKnowledge,
  useKnowledgeDoc,
  useUpdateKnowledge,
} from "@/hooks/useKnowledge";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { KNOWLEDGE_KINDS, type KnowledgeKind } from "@agora/shared";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

const supabase = createClient();

const KIND_LABEL: Record<KnowledgeKind, string> = {
  general: "General",
  faq: "FAQ",
  decision: "Decision",
  runbook: "Runbook",
  onboarding: "Onboarding",
};

export default function KnowledgeDocPage({
  params,
}: { params: Promise<{ workspaceSlug: string; docId: string }> }) {
  const { workspaceSlug, docId } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftKind, setDraftKind] = useState<KnowledgeKind>("general");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");

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

  const doc = useKnowledgeDoc(token, workspaceId, docId);
  const update = useUpdateKnowledge(token, workspaceId);
  const del = useDeleteKnowledge(token, workspaceId);

  function startEdit() {
    if (!doc.data) return;
    setDraftKind(doc.data.kind);
    setDraftTitle(doc.data.title);
    setDraftContent(doc.data.content);
    setEditing(true);
  }

  async function save() {
    if (!doc.data) return;
    try {
      await update.mutateAsync({
        docId,
        data: { kind: draftKind, title: draftTitle.trim(), content: draftContent },
      });
      setEditing(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    }
  }

  async function remove() {
    if (!confirm("Delete this doc? This can't be undone.")) return;
    try {
      await del.mutateAsync(docId);
      router.push(`/${workspaceSlug}/knowledge`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Delete failed", "error");
    }
  }

  if (doc.isLoading) {
    return (
      <div>
        <PageHeader eyebrow="Knowledge" title={<Skeleton className="h-7 w-48" />} />
        <div className="p-8 max-w-3xl mx-auto space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  if (!doc.data) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <p className="text-[13px] text-gray-500">Doc not found.</p>
        <Link
          href={`/${workspaceSlug}/knowledge`}
          className="text-[13px] text-indigo-700 hover:underline"
        >
          ← Back to knowledge
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-canvas">
      <PageHeader
        eyebrow={`Knowledge · ${KIND_LABEL[doc.data.kind]}`}
        title={doc.data.title}
        actions={
          editing ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-3.5 py-1.5 text-[13px] text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={update.isPending || !draftTitle.trim()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium transition-all active:scale-[0.97] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                {update.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={remove}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 rounded-md transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
              <button
                type="button"
                onClick={startEdit}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] text-gray-700 hover:text-gray-900 hover:bg-gray-50 border border-gray-200 rounded-md transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            </>
          )
        }
      />

      <div className="p-8 max-w-3xl mx-auto agora-fade-in">
        {editing ? (
          <div className="space-y-4">
            <select
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value as KnowledgeKind)}
              className="bg-white border border-gray-200 rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-indigo-300"
            >
              {KNOWLEDGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              maxLength={200}
              className="w-full bg-white border border-gray-200 rounded-md px-3 py-2 text-[16px] font-medium focus:outline-none focus:border-indigo-300 focus:shadow-[0_0_0_3px_oklch(0.93_0.04_255_/_0.6)] transition-shadow"
            />
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={20}
              placeholder="Markdown supported."
              className="w-full bg-white border border-gray-200 rounded-md px-3 py-2 text-[13px] leading-relaxed font-mono focus:outline-none focus:border-indigo-300 focus:shadow-[0_0_0_3px_oklch(0.93_0.04_255_/_0.6)] transition-shadow"
            />
          </div>
        ) : doc.data.content ? (
          <article className="prose prose-sm max-w-none prose-gray">
            <Markdown source={doc.data.content} />
          </article>
        ) : (
          <p className="text-[13px] text-gray-400 italic">Empty doc — click Edit to add content.</p>
        )}
      </div>
    </div>
  );
}

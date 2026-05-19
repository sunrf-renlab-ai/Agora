"use client";
import { useMyFeedback, useSubmitFeedback } from "@/hooks/useFeedback";
import { PageHeader } from "@/components/ui/PageHeader";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { FeedbackKind } from "@agora/shared";
import { use, useEffect, useState } from "react";

const supabase = createClient();

export default function FeedbackPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<FeedbackKind>("general");
  const [error, setError] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const t = data.session.access_token;
      setToken(t);
      try {
        const workspaces = (await api.listWorkspaces(t)) as Array<{ id: string; slug: string }>;
        const ws = workspaces.find((w) => w.slug === workspaceSlug);
        if (ws) setWorkspaceId(ws.id);
      } catch {
        // ignore — feedback works without workspace context too
      }
    });
  }, [workspaceSlug]);

  const { data: items, isLoading } = useMyFeedback(token);
  const submitMutation = useSubmitFeedback(token);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await submitMutation.mutateAsync({
        content: content.trim(),
        kind,
        workspaceId,
        metadata: {},
      });
      setContent("");
      setKind("general");
      setSubmittedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit feedback");
    }
  }

  if (!token) return <div className="p-8 text-gray-400">Not signed in.</div>;

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Feedback"
        subtitle="Tell us what's working, what's broken, or what you wish existed."
      />
      <div className="p-8 max-w-2xl">

      <form onSubmit={handleSubmit} className="space-y-3 mb-8">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="fb-kind">
            Type
          </label>
          <select
            id="fb-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as FeedbackKind)}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="general">General</option>
            <option value="bug">Bug</option>
            <option value="feature">Feature request</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="fb-content">
            Message
          </label>
          <textarea
            id="fb-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            minLength={1}
            maxLength={20000}
            rows={6}
            placeholder="What's on your mind?"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        {submittedAt && !error && (
          <div className="text-sm text-green-600">Thanks! Feedback submitted.</div>
        )}
        <button
          type="submit"
          disabled={submitMutation.isPending || content.trim().length === 0}
          className="bg-indigo-600 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {submitMutation.isPending ? "Submitting…" : "Submit feedback"}
        </button>
      </form>

      <h2 className="text-lg font-semibold mb-3">Your submissions</h2>
      {isLoading ? (
        <div className="text-gray-400 text-sm">Loading…</div>
      ) : !items || items.length === 0 ? (
        <div className="text-sm text-gray-400">No submissions yet.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((f) => (
            <li key={f.id} className="border rounded p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase tracking-wide text-gray-500">{f.kind}</span>
                <span className="text-xs text-gray-400">
                  {new Date(f.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{f.content}</p>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}

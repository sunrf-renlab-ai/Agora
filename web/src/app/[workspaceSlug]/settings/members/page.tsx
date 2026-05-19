"use client";
import { PageHeader } from "@/components/ui/PageHeader";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { Member } from "@agora/shared";
import { useEffect, useState } from "react";
import { use } from "react";

interface GeneratedInvite {
  inviteUrl: string;
  role: string;
  createdAt: number;
}

export default function MembersPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = use(params);
  const [members, setMembers] = useState<Member[]>([]);
  const [role, setRole] = useState<"admin" | "member">("member");
  const [generated, setGenerated] = useState<GeneratedInvite[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const supabase = createClient();

  // biome-ignore lint/correctness/useExhaustiveDependencies: supabase client is stable singleton
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const token = data.session.access_token;
      const workspaces = await api.listWorkspaces(token);
      const ws = workspaces.find((w: { slug: string }) => w.slug === workspaceSlug);
      if (!ws) return;
      setWorkspaceId(ws.id);
      const m = await api.listMembers(token, ws.id);
      setMembers(m);
      setLoading(false);
    });
  }, [workspaceSlug]);

  async function handleGenerate() {
    if (!workspaceId) return;
    setGenerating(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const inv = (await api.inviteMember(data.session.access_token, workspaceId, {
        role,
      })) as { inviteUrl: string; role: string };
      // Newest link goes on top so the latest one to copy is always at hand.
      setGenerated((prev) => [
        { inviteUrl: inv.inviteUrl, role: inv.role, createdAt: Date.now() },
        ...prev,
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate invite link");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy(url: string, idx: number) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedAt(idx);
      setTimeout(() => setCopiedAt(null), 1500);
    } catch {
      // navigator.clipboard rejects in some sandboxed contexts; the link
      // is still visible on-screen for manual selection.
    }
  }

  if (loading) return <div className="p-8">Loading…</div>;

  return (
    <div>
      <PageHeader eyebrow="Settings" title="Members" />
      <div className="p-8 max-w-2xl">
        <table className="w-full text-sm mb-8">
          <thead>
            <tr className="text-left border-b">
              <th className="pb-2">Name</th>
              <th className="pb-2">Email</th>
              <th className="pb-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b">
                <td className="py-2">{m.user?.name}</td>
                <td className="py-2 text-gray-500">{m.user?.email}</td>
                <td className="py-2 capitalize">{m.role}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="text-lg font-semibold mb-1">Invite by link</h2>
        <p className="text-[12px] text-gray-500 mb-3 leading-relaxed">
          Anyone with the link can join this workspace. No email required —
          generate a link, then share it however you want (Slack, email,
          paste in a doc).
        </p>
        <div className="flex gap-2 items-center">
          <label htmlFor="invite-role" className="sr-only">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
            className="border border-gray-200 rounded px-3 py-2 text-[13px] focus:border-indigo-600 focus:outline-none transition-colors"
          >
            <option value="member">Join as member</option>
            <option value="admin">Join as admin</option>
          </select>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-4 py-2 text-[13px] font-medium disabled:opacity-60 transition-colors"
          >
            {generating ? "Generating…" : "Generate invite link"}
          </button>
        </div>
        {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}

        {generated.length > 0 && (
          <div className="mt-4 space-y-2">
            {generated.map((inv, idx) => (
              <div
                key={inv.createdAt}
                className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wide text-emerald-700 font-medium">
                    {idx === 0 ? "New invite link" : "Earlier link"} · {inv.role}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(inv.inviteUrl, idx)}
                    className="text-[12px] text-indigo-700 hover:text-indigo-900 font-medium"
                  >
                    {copiedAt === idx ? "Copied!" : "Copy"}
                  </button>
                </div>
                <code className="block break-all font-mono text-[12px] text-gray-700">
                  {inv.inviteUrl}
                </code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

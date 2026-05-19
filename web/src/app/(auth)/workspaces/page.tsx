"use client";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { Workspace } from "@agora/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface PendingInvitation {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  role: string;
  token: string;
}

/**
 * Workspace picker / first-run landing. Decides between three states:
 *
 *   workspaces > 0          → straight into the (only / picked) workspace
 *   workspaces == 0 + invites → show pending invitations to accept
 *   workspaces == 0 + 0 invites → push to /workspaces/new
 *
 * The middle case is the important one for "wait for someone to invite me"
 * users — we never force them through workspace creation if they have a
 * pending invite to land on.
 */
export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  // biome-ignore lint/correctness/useExhaustiveDependencies: supabase client is stable singleton
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.push("/login");
        return;
      }
      const token = data.session.access_token;
      try {
        const [ws, invs] = await Promise.all([
          api.listWorkspaces(token) as Promise<Workspace[]>,
          api.listInvitations(token) as Promise<PendingInvitation[]>,
        ]);
        if (ws.length === 1 && invs.length === 0) {
          const first = ws[0];
          if (first) {
            router.replace(`/${first.slug}/issues`);
            return;
          }
        }
        if (ws.length === 0 && invs.length === 0) {
          router.replace("/workspaces/new");
          return;
        }
        setWorkspaces(ws);
        setInvitations(invs);
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  async function handleAccept(invToken: string) {
    setError(null);
    setAccepting(invToken);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const r = (await api.acceptInvitation(data.session.access_token, invToken)) as {
        workspaceId: string;
      };
      // Find the slug we just joined so we can land directly inside.
      const ws = (await api.listWorkspaces(data.session.access_token)) as Workspace[];
      const joined = ws.find((w) => w.id === r.workspaceId);
      if (joined) router.replace(`/${joined.slug}/issues`);
      else router.replace("/workspaces");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to accept invitation");
      setAccepting(null);
    }
  }

  async function handleDecline(invToken: string) {
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      await api.declineInvitation(data.session.access_token, invToken);
      setInvitations((prev) => prev.filter((i) => i.token !== invToken));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to decline");
    }
  }

  if (loading) return <div className="p-8">Loading…</div>;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 py-12">
      <div className="bg-white rounded-xl shadow p-8 w-full max-w-md">
        {invitations.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[12px] font-medium uppercase tracking-wide text-gray-500 mb-2">
              Pending invitations
            </h2>
            <ul className="space-y-2">
              {invitations.map((inv) => (
                <li
                  key={inv.id}
                  className="border border-indigo-200 bg-indigo-50/50 rounded-md px-4 py-3"
                >
                  <div className="text-[14px] font-medium text-gray-900">
                    {inv.workspaceName ?? "Unknown workspace"}
                  </div>
                  <div className="text-[12px] text-gray-600 capitalize mb-3">
                    Role: {inv.role}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleAccept(inv.token)}
                      disabled={accepting !== null}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-3 py-1.5 text-[12px] font-medium disabled:opacity-60"
                    >
                      {accepting === inv.token ? "Joining…" : "Accept"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDecline(inv.token)}
                      disabled={accepting !== null}
                      className="text-gray-600 hover:text-red-600 hover:bg-red-50 rounded px-3 py-1.5 text-[12px] font-medium disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <h1 className="text-xl font-bold mb-4">Your workspaces</h1>
        {workspaces.length === 0 ? (
          <p className="text-gray-500 mb-4 text-[13px]">
            You're not in any workspace yet. Accept an invitation above, or
            create your own below.
          </p>
        ) : (
          <ul className="mb-4 space-y-2">
            {workspaces.map((ws) => (
              <li key={ws.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/${ws.slug}/issues`)}
                  className="w-full text-left px-4 py-3 rounded border hover:bg-gray-50 font-medium"
                >
                  {ws.name}
                  <span className="text-gray-400 text-sm ml-2">{ws.slug}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-[12px] text-red-600 mb-3">{error}</p>}

        <Link
          href="/workspaces/new"
          className="block text-center bg-indigo-600 text-white rounded px-4 py-2 font-medium"
        >
          Create workspace
        </Link>
      </div>
    </div>
  );
}

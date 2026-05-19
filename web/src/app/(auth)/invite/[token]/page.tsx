"use client";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [invitation, setInvitation] = useState<{ workspaceName: string; role: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  // biome-ignore lint/correctness/useExhaustiveDependencies: supabase client is stable singleton
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.push(`/login?next=/invite/${token}`);
        return;
      }
      try {
        const inv = await api.getInvitation(data.session.access_token, token);
        setInvitation(inv);
      } catch {
        setInvitation(null);
      } finally {
        setLoading(false);
      }
    });
  }, [token, router]);

  async function handleAccept() {
    const { data } = await supabase.auth.getSession();
    if (!data.session || !invitation) return;
    const accessToken = data.session.access_token;
    setAccepting(true);
    setActionError(null);
    let accepted: { workspaceId: string };
    try {
      accepted = (await api.acceptInvitation(accessToken, token)) as {
        workspaceId: string;
      };
    } catch {
      // Expired / already-used invite, or a transient failure — surface a
      // message instead of silently failing on the Accept click.
      setAccepting(false);
      setActionError("This invitation can't be accepted — it may have expired.");
      return;
    }
    // Route straight into the workspace so the per-member onboarding gate
    // (layout.tsx) immediately sends the new member to /onboarding to
    // connect their own machine. Fall back to the workspace picker if the
    // slug can't be resolved.
    try {
      const workspaces = (await api.listWorkspaces(accessToken)) as Array<{
        id: string;
        slug: string;
      }>;
      const ws = workspaces.find((w) => w.id === accepted.workspaceId);
      router.push(ws ? `/${ws.slug}` : "/workspaces");
    } catch {
      router.push("/workspaces");
    }
  }

  async function handleDecline() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await api.declineInvitation(data.session.access_token, token);
    router.push("/workspaces");
  }

  if (loading) return <div className="p-8">Loading…</div>;
  if (!invitation) return <div className="p-8">Invitation not found or expired.</div>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow p-8 w-full max-w-sm text-center">
        <h1 className="text-xl font-bold mb-2">You&apos;re invited!</h1>
        <p className="text-gray-600 mb-6">
          Join <strong>{invitation.workspaceName}</strong> as <strong>{invitation.role}</strong>
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            className="bg-indigo-600 text-white rounded px-6 py-2 font-medium disabled:bg-gray-200 disabled:text-gray-400"
          >
            {accepting ? "Joining…" : "Accept"}
          </button>
          <button
            type="button"
            onClick={handleDecline}
            disabled={accepting}
            className="border rounded px-6 py-2 font-medium text-gray-600 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
        {actionError && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {actionError}
          </p>
        )}
      </div>
    </div>
  );
}

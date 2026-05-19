"use client";
import { use, useEffect, useState } from "react";

import { IssueDetailView } from "@/components/issues/IssueDetailView";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export default function IssueDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; issueId: string }>;
}) {
  const { workspaceSlug, issueId } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const t = data.session.access_token;
      setToken(t);
      const me = await api.getMe(t);
      setUserId((me as { id: string }).id);
      const workspaces = await api.listWorkspaces(t);
      const ws = (workspaces as Array<{ id: string; slug: string }>).find(
        (w) => w.slug === workspaceSlug,
      );
      if (!ws) return;
      setWorkspaceId(ws.id);
    });
  }, [workspaceSlug]);

  return (
    <IssueDetailView
      issueId={issueId}
      workspaceSlug={workspaceSlug}
      token={token}
      workspaceId={workspaceId}
      userId={userId}
    />
  );
}

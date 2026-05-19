"use client";
import { ShortcutsHelpModal } from "@/components/help/ShortcutsHelpModal";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { useAgents } from "@/hooks/useAgents";
import { useMembers } from "@/hooks/useMembers";
import { useRuntimes } from "@/hooks/useRuntimes";
import { useShortcuts } from "@/hooks/useShortcuts";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { useUiStore } from "@/lib/ui-store";
import { usePathname, useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";

const supabase = createClient();

// Only /onboarding is reachable before onboarding completes. Anything else
// (including /settings) bounces back to the wizard. The product is unusable
// without an agent — registration must connect one before the user sees
// anything else.
const GATE_BYPASS_PREFIXES = ["/onboarding"];

export default function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const setShortcutsHelpOpen = useUiStore((s) => s.setShortcutsHelpOpen);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const t = data.session.access_token;
      setToken(t);
      const [workspaces, me] = await Promise.all([api.listWorkspaces(t), api.getMe(t)]);
      const ws = (workspaces as Array<{ id: string; slug: string }>).find(
        (w) => w.slug === workspaceSlug,
      );
      if (ws) setWorkspaceId(ws.id);
      setMeId((me as { id: string }).id);
    });
  }, [workspaceSlug]);

  // Onboarding gate: until THIS member has their own online runtime AND
  // owns at least one agent, every page except /onboarding redirects to
  // /onboarding. The gate is per-member, not per-workspace — an invited
  // member joining a workspace the owner already set up still has to
  // connect their own machine ("you bring the runtime"). The gate runs
  // once every query has a definitive answer (data + isFetched) so we
  // don't bounce on cold-load empty arrays.
  const { data: runtimes = [], isFetched: runtimesFetched } = useRuntimes(token, workspaceId);
  const { data: agents = [], isFetched: agentsFetched } = useAgents(token, workspaceId);
  const { data: members = [], isFetched: membersFetched } = useMembers(token, workspaceId);
  const myMemberId = useMemo(
    () => (meId ? (members.find((m) => m.userId === meId)?.id ?? null) : null),
    [members, meId],
  );
  const subPath = pathname.startsWith(`/${workspaceSlug}`)
    ? pathname.slice(`/${workspaceSlug}`.length) || "/"
    : "/";
  const onBypassedRoute = GATE_BYPASS_PREFIXES.some((p) => subPath.startsWith(p));

  useEffect(() => {
    if (!workspaceId || !meId || !runtimesFetched || !agentsFetched || !membersFetched) return;
    if (onBypassedRoute) return;
    // E2E bypass: any URL carrying ?e2e=1 lets browser tests visit any route
    // without forcing a real daemon connection. Production users won't pass
    // this query param so the onboarding redirect still fires for them.
    if (
      typeof window !== "undefined" &&
      new URL(window.location.href).searchParams.get("e2e") === "1"
    )
      return;
    const myOnlineRuntime = runtimes.some((r) => r.online && r.memberId === myMemberId);
    const myAgent = agents.some((a) => a.ownerId === meId);
    if (!myOnlineRuntime || !myAgent) {
      router.replace(`/${workspaceSlug}/onboarding`);
    }
  }, [
    workspaceId,
    meId,
    myMemberId,
    runtimesFetched,
    agentsFetched,
    membersFetched,
    runtimes,
    agents,
    onBypassedRoute,
    workspaceSlug,
    router,
  ]);

  // Issue creation is no longer reachable from a hotkey or modal — every
  // issue (parent + sub-issues for orchestrator decomposition) flows
  // through the chat composer on the workspace home. Keep g-prefix nav
  // shortcuts and the ? help dialog.
  const shortcuts = useMemo(
    () => ({
      "g i": () => router.push(`/${workspaceSlug}/inbox`),
      "g a": () => router.push(`/${workspaceSlug}/agents`),
      "g p": () => router.push(`/${workspaceSlug}/projects`),
      "?": () => setShortcutsHelpOpen(true),
    }),
    [router, workspaceSlug, setShortcutsHelpOpen],
  );

  useShortcuts(shortcuts);

  // Onboarding takes the whole viewport — no sidebar / Vega / search chrome.
  // Same logic for the bypass routes (settings) feels wrong though, so only
  // /onboarding gets the chromeless treatment.
  if (subPath.startsWith("/onboarding")) {
    return <>{children}</>;
  }

  // Hold rendering until the onboarding gate has a definitive answer.
  // Without this hold the issues page (or whichever route the user landed
  // on) renders for ~1 frame, the useEffect above fires router.replace,
  // and the user sees a flash of the wrong page. Show a minimal stand-in
  // instead — blank canvas, no chrome flicker.
  const gatePending =
    !workspaceId || !meId || !runtimesFetched || !agentsFetched || !membersFetched;
  const needsOnboarding =
    !gatePending &&
    (!runtimes.some((r) => r.online && r.memberId === myMemberId) ||
      !agents.some((a) => a.ownerId === meId));
  const e2eBypass =
    typeof window !== "undefined" && new URL(window.location.href).searchParams.get("e2e") === "1";
  if (!onBypassedRoute && !e2eBypass && (gatePending || needsOnboarding)) {
    return <div className="h-screen w-screen bg-gray-50" />;
  }

  return (
    <div className="flex h-screen">
      <Sidebar token={token} workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
      <main className="flex-1 overflow-auto">{children}</main>
      <ShortcutsHelpModal />
    </div>
  );
}

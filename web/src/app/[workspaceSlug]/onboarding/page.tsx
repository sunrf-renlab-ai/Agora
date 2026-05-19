"use client";
import { useToast } from "@/components/ui/Toast";
import { useAgents, useCreateAgent } from "@/hooks/useAgents";
import { useMembers } from "@/hooks/useMembers";
import { useRuntimes } from "@/hooks/useRuntimes";
import { useWSChannel } from "@/hooks/useWSChannel";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { Runtime, WSMessage } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Sparkles, Terminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useRef, useState } from "react";

const supabase = createClient();

interface MeUser {
  id: string;
  name: string | null;
  email: string;
}

/**
 * One-line onboarding: user runs ONE curl line that downloads the
 * `agorad` binary, pairs this device, and starts the agent runtime in
 * the background. We don't pre-provision a runtime — the daemon
 * provisions itself once it has a PAT.
 *
 * Assumes the user already has at least one supported AI CLI on PATH
 * (claude / codex / gemini). The daemon detects whatever's installed
 * and reports back; the page just listens for the first online runtime
 * with any detected CLI, auto-creates a default agent named
 * "{user}'s {cli}", and redirects into the workspace.
 *
 * Hard gate in [workspaceSlug]/layout.tsx sends the user back here from
 * any other page until THIS member has their own online runtime AND
 * owns an agent — onboarding is per-member, so an invited teammate must
 * connect their own machine even if the workspace owner already did.
 */
export default function OnboardingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [me, setMe] = useState<MeUser | null>(null);
  const [agentCreated, setAgentCreated] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Synchronous re-entrancy guard for the creation effect. A useState flag
  // isn't enough on its own — it's only visible on the next render, so a
  // second effect run in the same render batch would still see the old
  // value. A ref mutation is seen immediately. (agents have no unique name
  // constraint, so a double create really does leave two identical
  // "{user}'s {cli}" agents.)
  const creatingAgentRef = useRef(false);
  // Pre-approved pair code baked into the install URL so the user can skip
  // `agorad login`. Generated once on mount; if it expires (5min) the user
  // refreshes the page.
  const [pairCode, setPairCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push("/login");
        return;
      }
      const t = data.session.access_token;
      if (cancelled) return;
      setToken(t);
      const [workspaces, meData, quickPair] = await Promise.all([
        api.listWorkspaces(t),
        api.getMe(t),
        api.quickPair(t),
      ]);
      const ws = (workspaces as Array<{ id: string; slug: string }>).find(
        (w) => w.slug === workspaceSlug,
      );
      if (cancelled) return;
      setMe(meData as MeUser);
      setPairCode((quickPair as { code: string }).code);
      if (ws) setWorkspaceId(ws.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, router]);

  const { data: runtimes = [] } = useRuntimes(token, workspaceId);
  const { data: agents = [], isFetched: agentsFetched } = useAgents(token, workspaceId);
  const { data: members = [] } = useMembers(token, workspaceId);
  const createAgent = useCreateAgent(token, workspaceId);

  // This member's own member id — onboarding is per-member, so we only
  // react to runtimes/agents that belong to the current user, never the
  // ones the workspace owner already set up.
  const myMemberId = useMemo(
    () => (me ? (members.find((m) => m.userId === me.id)?.id ?? null) : null),
    [members, me],
  );

  // Watch for THIS member's runtime coming online with a detected CLI.
  // The daemon binds itself by PAT-driven self-provisioning, so we don't
  // know its id ahead of time — just wait for the first online one with
  // a CLI that is owned by the current member.
  const onlineRuntime: Runtime | undefined = useMemo(
    () => runtimes.find((r) => r.online && r.detectedClis.length > 0 && r.memberId === myMemberId),
    [runtimes, myMemberId],
  );

  // Realtime invalidation so we don't sit on a 5s React Query stale window.
  useWSChannel(workspaceId, (msg: WSMessage) => {
    const t = msg.event.type;
    if (t === "runtime.online" || t === "runtime.offline") {
      qc.invalidateQueries({ queryKey: ["runtimes", workspaceId] });
    }
    if (t === "agent.created") {
      qc.invalidateQueries({ queryKey: ["agents", workspaceId] });
    }
  });

  // The moment we have a usable runtime, mint a default agent and bounce out.
  // Skip if THIS member already owns an agent — re-onboarding (e.g. user
  // reinstalled the daemon, or the gate bounced them back after a runtime
  // blip) shouldn't keep creating duplicates.
  //
  // `agentsFetched` is the load-bearing guard: until the agents query has
  // actually settled, `agents` is the default [] and `agents.some(...)`
  // is a false negative. If we don't wait for it, a member who already
  // owns an agent gets a SECOND identical one the moment their (already
  // running) daemon's runtime shows up before the query resolves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to the runtime appearing / agents settling
  useEffect(() => {
    if (!onlineRuntime || creatingAgentRef.current || !me) return;
    if (!agentsFetched) return;
    if (agents.some((a) => a.ownerId === me.id)) return;
    const cli = onlineRuntime.detectedClis[0];
    if (!cli) return;
    creatingAgentRef.current = true;
    setAgentCreated(true);
    const rawName = me.name?.trim() ?? "";
    const looksLikeEmail = rawName.includes("@");
    const userLabel = (!looksLikeEmail && rawName) || me.email.split("@")[0] || "Me";
    const agentName = `${userLabel}'s ${cliDisplayName(cli.kind)}`;
    createAgent
      .mutateAsync({
        name: agentName,
        description: `Default agent — uses ${userLabel}'s local ${cli.kind} CLI.`,
        instructions:
          "You are a helpful coding agent. When given an issue, investigate, " +
          "propose a plan, and ship the smallest correct change. Comment on " +
          "the issue with your progress. Ask the team if anything is ambiguous.",
        cliKind: cli.kind,
        runtimeId: onlineRuntime.id,
        visibility: "workspace",
      })
      .then(() => {
        toast(`Connected. Created ${agentName}.`, "success");
        router.replace(`/${workspaceSlug}`);
      })
      .catch((e: unknown) => {
        toast(e instanceof Error ? e.message : "Failed to create agent", "error");
        creatingAgentRef.current = false;
        setAgentCreated(false);
      });
  }, [onlineRuntime?.id, agentsFetched]);

  // Already onboarded? Bounce — but only if THIS member has their own
  // online runtime and owns an agent. A new member in a workspace the
  // owner already set up must not be bounced past their own setup.
  useEffect(() => {
    if (!workspaceId || !me) return;
    const myOnlineRuntime = runtimes.some((r) => r.online && r.memberId === myMemberId);
    const myAgent = agents.some((a) => a.ownerId === me.id);
    if (myOnlineRuntime && myAgent) {
      router.replace(`/${workspaceSlug}`);
    }
  }, [runtimes, agents, myMemberId, me, workspaceId, workspaceSlug, router]);

  const serverUrl =
    typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_API_URL ?? window.location.origin)
      : "";

  // Auto-pick the install command for the visitor's OS. macOS/Linux get
  // the bash curl|bash line; Windows gets the iwr|iex PowerShell line.
  // The user can flip the toggle if they're testing the other OS from
  // this browser. Detection is User-Agent based — good enough for the
  // default; the manual toggle is the escape hatch.
  const detectedOs: "unix" | "win" =
    typeof navigator !== "undefined" && /win/i.test(navigator.userAgent ?? "") ? "win" : "unix";
  const [installOs, setInstallOs] = useState<"unix" | "win">(detectedOs);

  // Bake the pre-approved code into the install URL so the server-side
  // install.{sh,ps1} writes ~/.agora/auth.json itself and the user skips
  // `agorad login`. If the code isn't ready yet (initial render), show
  // the plain URL — the exchange step just no-ops.
  //
  // Windows: wrap the iwr | iex pipe in `powershell -NoProfile -Command`
  // so the same line works in EITHER PowerShell or Command Prompt
  // (cmd.exe). Bare `iwr | iex` is PowerShell-only; users pasting into
  // cmd hit '"iwr" 不是内部或外部命令' and bounce. Universal form is a
  // ~20-char extra wrapper for unambiguous copy/paste UX.
  const winUrl = `${serverUrl}/api/cli/install.ps1${pairCode ? `?code=${encodeURIComponent(pairCode)}` : ""}`;
  const installCommand =
    installOs === "win"
      ? `powershell -NoProfile -Command "iwr -useb '${winUrl}' | iex"`
      : pairCode
        ? `curl -fsSL "${serverUrl}/api/cli/install.sh?code=${encodeURIComponent(pairCode)}" | bash`
        : `curl -fsSL ${serverUrl}/api/cli/install.sh | bash`;

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(label);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      toast("Couldn't copy — select manually", "error");
    }
  }

  const stage: "waiting" | "creating" | "done" = !onlineRuntime
    ? "waiting"
    : agentCreated
      ? "done"
      : "creating";

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-canvas">
      <div className="w-full max-w-xl">
        <header className="mb-8 text-center">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-2 font-semibold">
            One last step
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-3">
            Connect this machine
          </h1>
          <p className="text-[14px] text-gray-600 max-w-md mx-auto leading-relaxed">
            Run this in your terminal. We'll auto-detect any AI CLI you already have installed
            (Claude Code, Codex, or Gemini) and wire it up.
          </p>
        </header>

        <section
          className={`bg-white rounded-md border p-5 transition-colors ${
            stage === "done" ? "border-indigo-200" : "border-gray-200"
          }`}
        >
          <div
            role="radiogroup"
            aria-label="Operating system"
            className="mb-3 inline-flex rounded-md border border-gray-200 overflow-hidden text-[12px]"
          >
            <button
              type="button"
              role="radio"
              aria-checked={installOs === "unix"}
              onClick={() => setInstallOs("unix")}
              className={`px-3 py-1 transition-colors ${
                installOs === "unix"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              macOS · Linux
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={installOs === "win"}
              onClick={() => setInstallOs("win")}
              className={`px-3 py-1 transition-colors ${
                installOs === "win"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              Windows
            </button>
          </div>
          <CommandBlock
            text={installCommand}
            copied={copiedKey === "install"}
            onCopy={() => copy("install", installCommand)}
          />
          <p className="mt-2.5 text-[11px] text-gray-500 leading-relaxed">
            Installs the agorad binary, pairs this device, and starts the runtime in the background.
            The code in the URL is single-use and expires in 5 minutes.
          </p>
          <div className="mt-4 pt-4 border-t border-gray-100">
            {stage === "waiting" ? (
              <div className="flex items-center gap-2 text-[13px] text-gray-600">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                Listening for your daemon to come online…
              </div>
            ) : stage === "creating" ? (
              <div className="flex items-center gap-2 text-[13px] text-gray-600">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                Detected{" "}
                <code className="font-mono text-[12px] text-gray-700">
                  {onlineRuntime?.detectedClis.map((c) => cliDisplayName(c.kind)).join(", ")}
                </code>
                . Creating your agent…
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[13px] text-indigo-700">
                <Check className="w-4 h-4" />
                Taking you to your workspace…
              </div>
            )}
          </div>
        </section>

        <p className="mt-5 text-center text-[11px] text-gray-500 leading-relaxed">
          <Sparkles className="inline-block w-3 h-3 mr-1 text-gray-400" />
          Don't have a CLI yet? Install one of{" "}
          <a
            className="text-indigo-700 hover:underline"
            href="https://docs.claude.com/en/docs/claude-code/setup"
            target="_blank"
            rel="noreferrer noopener"
          >
            Claude Code
          </a>
          ,{" "}
          <a
            className="text-indigo-700 hover:underline"
            href="https://github.com/openai/codex"
            target="_blank"
            rel="noreferrer noopener"
          >
            Codex
          </a>
          , or{" "}
          <a
            className="text-indigo-700 hover:underline"
            href="https://github.com/google-gemini/gemini-cli"
            target="_blank"
            rel="noreferrer noopener"
          >
            Gemini
          </a>{" "}
          first, then re-run the command above.
        </p>
      </div>
    </div>
  );
}

function cliDisplayName(kind: string): string {
  if (kind === "claude_code") return "claude";
  if (kind === "codex") return "codex";
  if (kind === "gemini") return "gemini";
  if (kind === "openclaw") return "openclaw";
  if (kind === "hermes") return "hermes";
  return kind;
}

function CommandBlock({
  text,
  copied,
  onCopy,
}: {
  text: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="relative bg-gray-900 rounded-md overflow-hidden border border-gray-300">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 text-gray-400">
        <span className="flex items-center gap-1.5 text-[11px] font-mono">
          <Terminal className="w-3 h-3" /> bash
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="text-[11px] text-gray-400 hover:text-white flex items-center gap-1 font-mono transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" /> Copy
            </>
          )}
        </button>
      </div>
      <pre className="text-[12px] text-gray-100 px-4 py-3 overflow-x-auto leading-relaxed font-mono whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}

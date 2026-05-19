"use client";
import { useToast } from "@/components/ui/Toast";
import { useAgents } from "@/hooks/useAgents";
import { useChatSessions, useCreateChatSession } from "@/hooks/useChatSessions";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { ArrowUp, Bot, Loader2, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useRef, useState } from "react";

const supabase = createClient();

const PLACEHOLDERS = [
  "Investigate the flaky checkout test and propose a fix",
  "Triage the inbox and create issues for anything that isn't already tracked",
  "Draft an issue for migrating onboarding to the new design system",
  "Look at PR #42 and leave review comments",
  "Plan the v2 launch — break it into issues and assign each to someone",
];

/**
 * Workspace home — a single composer dialog. The user types one
 * instruction; we mint a chat session against their default agent and
 * route them into it. The agent (running on the local CLI via agorad)
 * handles the rest: filing issues, assigning agents, posting comments,
 * leaving PR reviews — anything the `agora` CLI can do.
 *
 * Replaces both the old /issues redirect home AND the right-edge
 * floating chat panel that used to live in the workspace layout.
 * The sidebar still exposes Issues / Agents / Projects / etc. for
 * users who want to navigate the UI directly.
 */
export default function WorkspaceHomePage({
  params,
}: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = use(params);
  const router = useRouter();
  const { toast } = useToast();

  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Resolve token + workspace.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push("/login");
        return;
      }
      if (cancelled) return;
      setToken(data.session.access_token);
      const workspaces = await api.listWorkspaces(data.session.access_token);
      const ws = (workspaces as Array<{ id: string; slug: string }>).find(
        (w) => w.slug === workspaceSlug,
      );
      if (!cancelled && ws) setWorkspaceId(ws.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, router]);

  const { data: agents = [] } = useAgents(token, workspaceId);
  const { data: sessions = [] } = useChatSessions(token, workspaceId);
  const createSession = useCreateChatSession(token, workspaceId);

  const activeAgents = useMemo(() => agents.filter((a) => a.archivedAt === null), [agents]);

  // Default to the first non-archived agent the moment we have one.
  useEffect(() => {
    if (agentId === "" && activeAgents.length > 0) {
      const first = activeAgents[0];
      if (first) setAgentId(first.id);
    }
  }, [agentId, activeAgents]);

  // Stable placeholder per page load — picked from PLACEHOLDERS by date so
  // the suggestion looks fresh without flickering on every re-render.
  const placeholder = useMemo(() => {
    const idx = Math.floor(Date.now() / 60_000) % PLACEHOLDERS.length;
    return PLACEHOLDERS[idx];
  }, []);

  // Recent chats — show up to 5 so user can resume rather than start a new
  // session for the same thread of work.
  const recentSessions = useMemo(() => sessions.slice(0, 5), [sessions]);

  async function submit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || submitting || !token || !workspaceId || agentId === "") return;
    setSubmitting(true);
    try {
      // Title is the first line, capped — mirrors how Linear / Slack derive
      // session names from the opener so the sidebar list reads cleanly.
      const firstLine = trimmed.split("\n", 1)[0] ?? trimmed;
      const title = firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
      const session = await createSession.mutateAsync({ agentId, title });
      // Critical-path optimization: navigate the moment we have a session
      // id. The first message goes via `void api.sendChatMessage(…)` —
      // a fire-and-forget fetch that survives the client-side route
      // change because it isn't tied to React Query / component lifecycle.
      // Result: the user lands on the chat page in ~1 RTT instead of 2,
      // and the message arrives via the WS chat.message_added invalidation
      // a moment later.
      void api
        .sendChatMessage(token, workspaceId, session.id, trimmed)
        .catch((e) => toast(e instanceof Error ? e.message : "Send failed", "error"));
      router.push(`/${workspaceSlug}/chat/${session.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to start", "error");
      setSubmitting(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
      e.preventDefault();
      submit();
    }
  }

  // Auto-grow textarea up to a max height — feels like a real chat composer.
  function autoresize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: track draft changes
  useEffect(() => {
    autoresize();
  }, [draft]);

  return (
    <div className="relative min-h-full flex items-center justify-center px-6 py-16 bg-canvas overflow-hidden">
      {/* Atmospheric backdrop — three soft radial blooms in brand blue
          and the warm priority orange. Restrained: 6-8% opacity each,
          sits well below content, breathes the page without becoming
          decoration. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(900px 600px at 18% 12%, oklch(0.96 0.04 255 / 0.55), transparent 60%)," +
            "radial-gradient(700px 500px at 82% 90%, oklch(0.97 0.05 80 / 0.45), transparent 60%)," +
            "radial-gradient(600px 480px at 50% 100%, oklch(0.97 0.03 286 / 0.4), transparent 65%)",
        }}
      />

      <div className="w-full max-w-2xl agora-fade-in">
        <header className="mb-10 text-center">
          <p
            className="text-[11px] uppercase tracking-[0.18em] text-gray-500 mb-3 font-semibold"
            style={{ animationDelay: "40ms" }}
          >
            Workspace
          </p>
          <h1
            className="text-[40px] leading-[1.1] tracking-tight text-gray-900 mb-4 agora-fade-in-up"
            style={{ animationDelay: "120ms" }}
          >
            What should the{" "}
            <span className="font-display italic text-indigo-700">team</span> ship today?
          </h1>
          <p
            className="text-[14px] text-gray-600 max-w-md mx-auto leading-relaxed agora-fade-in-up"
            style={{ animationDelay: "200ms" }}
          >
            Drop in a goal — every teammate's agents pick up the parts they're best at,
            and humans step in where judgment matters.
          </p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm p-3.5 focus-within:border-indigo-300 focus-within:shadow-md transition-all agora-fade-in-up"
          style={{ animationDelay: "280ms" }}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={3}
            disabled={submitting || activeAgents.length === 0}
            className="w-full resize-none border-0 bg-transparent px-2 py-1.5 text-[14px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-gray-100">
            <label className="flex items-center gap-2 text-[12px] text-gray-600">
              <Bot className="w-3.5 h-3.5 text-gray-400" />
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                disabled={submitting || activeAgents.length === 0}
                className="bg-transparent text-[12px] text-gray-900 font-medium focus:outline-none cursor-pointer disabled:cursor-default hover:text-indigo-700 transition-colors"
              >
                {activeAgents.length === 0 ? (
                  <option value="">no agents yet</option>
                ) : (
                  activeAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              type="submit"
              disabled={submitting || draft.trim().length === 0 || agentId === ""}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium transition-all hover:shadow-sm active:scale-[0.97] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…
                </>
              ) : (
                <>
                  Send <ArrowUp className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>

        <p
          className="mt-3 text-center text-[11px] text-gray-500 agora-fade-in"
          style={{ animationDelay: "360ms" }}
        >
          <kbd className="font-mono text-[10px] text-gray-600 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
            ⌘
          </kbd>{" "}
          <kbd className="font-mono text-[10px] text-gray-600 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
            Enter
          </kbd>{" "}
          to send
        </p>

        {recentSessions.length > 0 && (
          <section
            className="mt-12 agora-fade-in-up"
            style={{ animationDelay: "440ms" }}
          >
            <h2 className="text-[11px] uppercase tracking-[0.18em] text-gray-500 mb-3 font-semibold pl-3">
              Recent
            </h2>
            <ul className="divide-y divide-gray-100 border border-gray-200/70 rounded-md bg-white/60">
              {recentSessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/${workspaceSlug}/chat/${s.id}`}
                    className="group flex items-center gap-3 px-3.5 py-2.5 text-[13px] text-gray-700 hover:bg-gray-50/80 hover:text-gray-900 transition-colors first:rounded-t-md last:rounded-b-md"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-gray-400 shrink-0 group-hover:text-indigo-600 transition-colors" />
                    <span className="truncate flex-1">{s.title || "(untitled)"}</span>
                    <span className="font-display italic text-[11px] text-gray-400 tabular-nums shrink-0">
                      {relativeTime(s.updatedAt ?? s.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** Compact relative time — "3m", "2h", "5d". */
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

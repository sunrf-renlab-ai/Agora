"use client";
import { ChatSessionList } from "@/components/chat/ChatSessionList";
import { NewChatModal } from "@/components/chat/NewChatModal";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { MessageCircle, PanelLeftOpen, Plus } from "lucide-react";
import { use, useEffect, useState } from "react";

const supabase = createClient();
const HISTORY_OPEN_KEY = "agora.chat.history.open";

export default function ChatLandingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(HISTORY_OPEN_KEY);
    if (saved === "1") setHistoryOpen(true);
  }, []);

  function toggleHistory(next: boolean) {
    setHistoryOpen(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(HISTORY_OPEN_KEY, next ? "1" : "0");
    }
  }

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

  return (
    <div className="flex h-full">
      {historyOpen && (
        <ChatSessionList
          token={token}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          onNewChat={() => setShowNewChat(true)}
          onClose={() => toggleHistory(false)}
        />
      )}
      <div className="flex-1 flex items-center justify-center relative">
        {!historyOpen && (
          <button
            type="button"
            onClick={() => toggleHistory(true)}
            aria-label="Show chat history"
            title="Show chat history"
            className="absolute top-4 left-4 z-10 w-8 h-8 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}
        <div className="text-center max-w-sm px-6">
          <div
            aria-hidden
            className="w-12 h-12 mx-auto mb-4 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center"
          >
            <MessageCircle className="w-5 h-5" />
          </div>
          <h1 className="text-[16px] font-semibold text-gray-900 mb-1.5">
            Start a chat
          </h1>
          <p className="text-[13px] text-gray-500 leading-relaxed mb-5">
            Tell an agent what you want to do. It'll plan the work,
            confirm with you, then file the issues.
          </p>
          <button
            type="button"
            onClick={() => setShowNewChat(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New chat
          </button>
        </div>
      </div>
      <NewChatModal
        open={showNewChat}
        onClose={() => setShowNewChat(false)}
        token={token}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
      />
    </div>
  );
}

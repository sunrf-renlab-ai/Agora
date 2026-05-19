"use client";
import { AgoraThread } from "@/components/chat/AgoraThread";
import { AgoraThreadRuntime } from "@/components/chat/AgoraThreadRuntime";
import { ChatSessionList } from "@/components/chat/ChatSessionList";
import { NewChatModal } from "@/components/chat/NewChatModal";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { PanelLeftOpen } from "lucide-react";
import { use, useEffect, useState } from "react";

const supabase = createClient();
const HISTORY_OPEN_KEY = "agora.chat.history.open";

export default function ChatSessionPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; sessionId: string }>;
}) {
  const { workspaceSlug, sessionId } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  // History panel is hidden by default — closer to Claude.ai / ChatGPT
  // than Linear's persistent sidebar, gives the thread the full width.
  // Persist the user's choice in localStorage so toggling sticks.
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
          activeSessionId={sessionId}
          onNewChat={() => setShowNewChat(true)}
          onClose={() => toggleHistory(false)}
        />
      )}
      <div className="flex-1 flex flex-col min-w-0 relative">
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
        <AgoraThreadRuntime token={token} workspaceId={workspaceId} sessionId={sessionId}>
          <AgoraThread />
        </AgoraThreadRuntime>
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

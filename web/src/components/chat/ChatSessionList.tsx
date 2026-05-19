"use client";
import { useChatSessions, useDeleteChatSession } from "@/hooks/useChatSessions";
import { PanelLeftClose, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

interface Props {
  token: string | null;
  workspaceId: string | null;
  workspaceSlug: string;
  activeSessionId?: string;
  onNewChat: () => void;
  onClose: () => void;
}

/**
 * Slide-in history panel — kept hidden by default so the thread itself
 * gets the full horizontal space (closer to Claude.ai / ChatGPT than
 * Linear's persistent sidebar). The parent page controls open state;
 * this component just renders the panel content.
 */
export function ChatSessionList({
  token,
  workspaceId,
  workspaceSlug,
  activeSessionId,
  onNewChat,
  onClose,
}: Props) {
  const { data: sessions = [], isLoading } = useChatSessions(token, workspaceId);
  const deleteSession = useDeleteChatSession(token, workspaceId);

  function handleDelete(e: React.MouseEvent, sessionId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this chat?")) return;
    deleteSession.mutate(sessionId);
  }

  return (
    <aside className="w-72 border-r border-gray-200 bg-gray-50/60 flex flex-col shrink-0 h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <h2 className="text-[12px] font-medium uppercase tracking-wider text-gray-500">
          Chats
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide chat history"
          title="Hide chat history"
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-200/70 transition-colors"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 text-gray-700 hover:text-gray-900 rounded-md font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New chat
        </button>
      </div>
      <div className="flex-1 overflow-auto px-2 pb-3">
        {isLoading ? (
          <div className="px-3 py-2 text-[12px] text-gray-400">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-gray-400 leading-relaxed">
            No chats yet. Start one to begin.
          </div>
        ) : (
          <ul className="flex flex-col gap-px">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              return (
                <li key={session.id}>
                  <Link
                    href={`/${workspaceSlug}/chat/${session.id}`}
                    className={`group flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px] rounded-md transition-colors ${
                      isActive
                        ? "bg-white text-gray-900 font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                        : "text-gray-700 hover:bg-white/70 hover:text-gray-900"
                    }`}
                  >
                    <span className="truncate flex-1">{session.title}</span>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, session.id)}
                      aria-label="Delete chat"
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 p-0.5 rounded transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

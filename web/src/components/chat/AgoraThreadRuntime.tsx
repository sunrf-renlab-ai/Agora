"use client";
import { useChatMessages, useSendChatMessage } from "@/hooks/useChatMessages";
import {
  AssistantRuntimeProvider,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { ChatMessage } from "@agora/shared";
import { createContext, useContext, useMemo } from "react";

interface Props {
  token: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  children: React.ReactNode;
}

/**
 * Bridges the chat thread to per-task execution telemetry. While the
 * agent is generating its reply, AgoraThread reads activeTaskId from
 * this context to subscribe to `task.messages_appended` WS pushes and
 * render the tool-call trace inline (like Claude's UI). Plain pending
 * (no tool events yet) falls back to the typing-dots indicator.
 */
export interface ChatTraceCtx {
  token: string | null;
  workspaceId: string | null;
  activeTaskId: string | null;
  isRunning: boolean;
}
const ChatTraceContext = createContext<ChatTraceCtx>({
  token: null,
  workspaceId: null,
  activeTaskId: null,
  isRunning: false,
});

export function useChatTrace(): ChatTraceCtx {
  return useContext(ChatTraceContext);
}

/**
 * ExternalStoreRuntime adapter that wires Agora's existing chat hooks
 * into assistant-ui. The runtime is the source of truth for the UI;
 * messages still live in React Query / WS-pushed cache.
 *
 * Why ExternalStore (not LocalRuntime / Transport):
 * - Agora's "assistant turn" is asynchronous: the daemon claims a task,
 *   spawns a CLI, posts back via REST. There's no SSE stream to plug
 *   into. WS pushes `chat.message_added` which already invalidates the
 *   useChatMessages query — assistant-ui just needs to mirror that.
 * - We can't easily cancel a running turn from the web (the daemon owns
 *   the subprocess), so the runtime's cancel/edit affordances are
 *   intentionally unset.
 */
export function AgoraThreadRuntime({ token, workspaceId, sessionId, children }: Props) {
  const { data: messages = [] } = useChatMessages(token, workspaceId, sessionId);
  const sendMessage = useSendChatMessage(token, workspaceId, sessionId);

  // The assistant is "running" whenever the last message is from the user
  // — that's when we're waiting on the daemon to push the assistant turn.
  // Keeps the composer's loading state honest without a separate isPending
  // flag from the daemon.
  const isRunning = useMemo(() => {
    const last = messages[messages.length - 1];
    return last !== undefined && last.role === "user";
  }, [messages]);

  // The "active task" is the one we're waiting on right now. Comes from
  // the last user message's taskId (set by /chat/sessions/.../messages
  // when enqueueing). Null when isRunning=false so useTaskMessages
  // unsubscribes cleanly.
  const activeTaskId = useMemo(() => {
    if (!isRunning) return null;
    const last = messages[messages.length - 1];
    return last?.taskId ?? null;
  }, [isRunning, messages]);

  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages,
    isRunning,
    // Agora ChatMessage → assistant-ui ThreadMessageLike. Called per message
    // when the runtime needs to render — assistant-ui memoizes by reference
    // so as long as `messages` array identity is stable, this is cheap.
    convertMessage: toThreadMessage,
    async onNew(message) {
      // assistant-ui calls onNew with the freshly-typed user message. We
      // just forward the raw text; the WS invalidation pushes both the
      // user echo + the eventual assistant reply back into our cache.
      const text = message.content
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("")
        .trim();
      if (text.length === 0) return;
      await sendMessage.mutateAsync(text);
    },
  });

  const traceCtx = useMemo<ChatTraceCtx>(
    () => ({ token, workspaceId, activeTaskId, isRunning }),
    [token, workspaceId, activeTaskId, isRunning],
  );

  return (
    <ChatTraceContext.Provider value={traceCtx}>
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </ChatTraceContext.Provider>
  );
}

function toThreadMessage(msg: ChatMessage): ThreadMessageLike {
  // Failed assistant turns get rendered with a red bubble in our Thread
  // UI; we surface the failure via custom metadata so the renderer can
  // distinguish "agent replied" from "agent crashed".
  const failed = msg.role === "assistant" && msg.failureReason !== null;
  return {
    id: msg.id,
    role: msg.role,
    content: [
      {
        type: "text",
        text: failed ? (msg.content || msg.failureReason || "(failed)") : msg.content,
      },
    ],
    createdAt: new Date(msg.createdAt),
    metadata: {
      custom: {
        failureReason: msg.failureReason,
        elapsedMs: msg.elapsedMs,
        taskId: msg.taskId,
      },
    },
  };
}

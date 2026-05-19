"use client";
import { api } from "@/lib/api";
import type { ChatMessage } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWSChannel } from "./useWSChannel";

export function useChatMessages(
  token: string | null,
  workspaceId: string | null,
  sessionId: string | null,
) {
  const qc = useQueryClient();
  const query = useQuery<ChatMessage[]>({
    queryKey: ["chat-messages", workspaceId, sessionId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: gate
      return api.listChatMessages(token!, workspaceId!, sessionId!) as Promise<ChatMessage[]>;
    },
    enabled: !!token && !!workspaceId && !!sessionId,
  });

  // Invalidate on chat.message_added for our session.
  useWSChannel(workspaceId, (msg) => {
    if (
      msg.event.type === "chat.message_added" &&
      (msg.event.data as { sessionId: string }).sessionId === sessionId
    ) {
      qc.invalidateQueries({ queryKey: ["chat-messages", workspaceId, sessionId] });
    }
  });

  return query;
}

export function useSendChatMessage(
  token: string | null,
  workspaceId: string | null,
  sessionId: string | null,
) {
  const qc = useQueryClient();
  const queryKey = ["chat-messages", workspaceId, sessionId];
  return useMutation({
    mutationFn: (content: string) => {
      // biome-ignore lint/style/noNonNullAssertion: gate
      return api.sendChatMessage(token!, workspaceId!, sessionId!, content);
    },
    // Optimistic update: paint the user's message into the assistant-ui
    // thread the instant they hit Send, before the server round-trip
    // returns. The chat input feels snappy on Render free tier where
    // /api/chat/send takes 200-600ms (Vercel rewrite + Supabase pooler).
    // The temporary `id: temp-<rand>` row is replaced by the real one
    // when the WS `chat.message_added` invalidation refetches.
    async onMutate(content: string) {
      if (!sessionId) return;
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<ChatMessage[]>(queryKey) ?? [];
      const optimistic: ChatMessage = {
        id: `temp-${crypto.randomUUID()}`,
        chatSessionId: sessionId,
        role: "user",
        content,
        taskId: null,
        failureReason: null,
        elapsedMs: null,
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<ChatMessage[]>(queryKey, [...prev, optimistic]);
      return { prev };
    },
    onError(_err, _content, ctx) {
      // Roll back the optimistic insert so the user can retry. Toast is
      // surfaced by the caller (composer / home submit).
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled() {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["chat-sessions", workspaceId] });
    },
  });
}

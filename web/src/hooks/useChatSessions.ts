"use client";
import { api } from "@/lib/api";
import type { ChatSession } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useChatSessions(token: string | null, workspaceId: string | null) {
  return useQuery<ChatSession[]>({
    queryKey: ["chat-sessions", workspaceId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled gate
      return api.listChatSessions(token!, workspaceId!) as Promise<ChatSession[]>;
    },
    enabled: !!token && !!workspaceId,
  });
}

export function useCreateChatSession(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { agentId: string; title?: string }) => {
      // biome-ignore lint/style/noNonNullAssertion: gate
      return api.createChatSession(token!, workspaceId!, data) as Promise<ChatSession>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-sessions", workspaceId] }),
  });
}

export function useRenameChatSession(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) => {
      // biome-ignore lint/style/noNonNullAssertion: gate
      return api.renameChatSession(token!, workspaceId!, sessionId, title);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-sessions", workspaceId] }),
  });
}

export function useDeleteChatSession(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => {
      // biome-ignore lint/style/noNonNullAssertion: gate
      return api.deleteChatSession(token!, workspaceId!, sessionId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-sessions", workspaceId] }),
  });
}

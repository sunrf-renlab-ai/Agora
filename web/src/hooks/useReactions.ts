"use client";
import { api } from "@/lib/api";
import type { Reaction } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useIssueReactions(
  token: string | null,
  workspaceId: string | null,
  issueId: string | null,
) {
  return useQuery<Reaction[]>({
    queryKey: ["reactions", "issue", workspaceId, issueId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listIssueReactions(token!, workspaceId!, issueId!) as Promise<Reaction[]>;
    },
    enabled: !!token && !!workspaceId && !!issueId,
  });
}

export function useAddIssueReaction(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, emoji }: { issueId: string; emoji: string }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.addIssueReaction(token!, workspaceId!, issueId, emoji);
    },
    onSuccess: (_, { issueId }) => {
      qc.invalidateQueries({ queryKey: ["reactions", "issue", workspaceId, issueId] });
    },
  });
}

export function useRemoveIssueReaction(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, emoji }: { issueId: string; emoji: string }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.removeIssueReaction(token!, workspaceId!, issueId, emoji);
    },
    onSuccess: (_, { issueId }) => {
      qc.invalidateQueries({ queryKey: ["reactions", "issue", workspaceId, issueId] });
    },
  });
}

export function useCommentReactions(
  token: string | null,
  workspaceId: string | null,
  commentId: string | null,
) {
  return useQuery<Reaction[]>({
    queryKey: ["reactions", "comment", workspaceId, commentId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listCommentReactions(token!, workspaceId!, commentId!) as Promise<Reaction[]>;
    },
    enabled: !!token && !!workspaceId && !!commentId,
  });
}

export function useAddCommentReaction(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji: string }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.addCommentReaction(token!, workspaceId!, commentId, emoji);
    },
    onSuccess: (_, { commentId }) => {
      qc.invalidateQueries({ queryKey: ["reactions", "comment", workspaceId, commentId] });
    },
  });
}

export function useRemoveCommentReaction(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji: string }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.removeCommentReaction(token!, workspaceId!, commentId, emoji);
    },
    onSuccess: (_, { commentId }) => {
      qc.invalidateQueries({ queryKey: ["reactions", "comment", workspaceId, commentId] });
    },
  });
}

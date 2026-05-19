"use client";
import { api } from "@/lib/api";
import type { Issue } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useIssues(
  token: string | null,
  workspaceId: string | null,
  status?: string,
  labelIds?: string[],
  projectId?: string,
) {
  return useQuery<Issue[]>({
    queryKey: ["issues", workspaceId, status, labelIds?.join(",") ?? "", projectId ?? ""],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listIssues(token!, workspaceId!, { status, labelIds, projectId });
    },
    enabled: !!token && !!workspaceId,
  });
}

export function useIssue(token: string | null, workspaceId: string | null, issueId: string | null) {
  return useQuery<Issue>({
    queryKey: ["issue", workspaceId, issueId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.getIssue(token!, workspaceId!, issueId!);
    },
    enabled: !!token && !!workspaceId && !!issueId,
  });
}

export function useCreateIssue(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      assigneeKind?: string;
      assigneeId?: string;
      parentIssueId?: string;
      projectId?: string;
      dueDate?: string;
    }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.createIssue(token!, workspaceId!, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issues", workspaceId] });
    },
  });
}

export function useUpdateIssue(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, data }: { issueId: string; data: Record<string, unknown> }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.updateIssue(token!, workspaceId!, issueId, data);
    },
    onSuccess: (_, { issueId }) => {
      qc.invalidateQueries({ queryKey: ["issues", workspaceId] });
      qc.invalidateQueries({ queryKey: ["issue", workspaceId, issueId] });
    },
  });
}

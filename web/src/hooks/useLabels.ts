"use client";
import { api } from "@/lib/api";
import type { Label } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useLabels(token: string | null, workspaceId: string | null) {
  return useQuery<Label[]>({
    queryKey: ["labels", workspaceId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listLabels(token!, workspaceId!) as Promise<Label[]>;
    },
    enabled: !!token && !!workspaceId,
  });
}

export function useCreateLabel(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color: string }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.createLabel(token!, workspaceId!, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels", workspaceId] });
    },
  });
}

export function useUpdateLabel(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      labelId,
      data,
    }: {
      labelId: string;
      data: Partial<{ name: string; color: string }>;
    }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.updateLabel(token!, workspaceId!, labelId, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels", workspaceId] });
    },
  });
}

export function useDeleteLabel(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.deleteLabel(token!, workspaceId!, labelId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels", workspaceId] });
      qc.invalidateQueries({ queryKey: ["issues", workspaceId] });
    },
  });
}

export function useAssignIssueLabels(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, labelIds }: { issueId: string; labelIds: string[] }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.setIssueLabels(token!, workspaceId!, issueId, labelIds);
    },
    onSuccess: (_, { issueId }) => {
      qc.invalidateQueries({ queryKey: ["issues", workspaceId] });
      qc.invalidateQueries({ queryKey: ["issue", workspaceId, issueId] });
      qc.invalidateQueries({ queryKey: ["issueLabels", workspaceId, issueId] });
    },
  });
}

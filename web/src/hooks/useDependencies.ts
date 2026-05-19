"use client";
import { api } from "@/lib/api";
import type { IssueDependencyView } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useIssueDependencies(
  token: string | null,
  workspaceId: string | null,
  issueId: string | null,
) {
  return useQuery<IssueDependencyView>({
    queryKey: ["dependencies", workspaceId, issueId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listDependencies(token!, workspaceId!, issueId!) as Promise<IssueDependencyView>;
    },
    enabled: !!token && !!workspaceId && !!issueId,
  });
}

export function useAddDependency(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      issueId,
      dependsOnIssueId,
      type,
    }: {
      issueId: string;
      dependsOnIssueId: string;
      type: "blocks" | "related";
    }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.addDependency(token!, workspaceId!, issueId, { dependsOnIssueId, type });
    },
    onSuccess: (_, { issueId, dependsOnIssueId }) => {
      qc.invalidateQueries({ queryKey: ["dependencies", workspaceId, issueId] });
      qc.invalidateQueries({ queryKey: ["dependencies", workspaceId, dependsOnIssueId] });
    },
  });
}

export function useRemoveDependency(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, depId }: { issueId: string; depId: string }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.removeDependency(token!, workspaceId!, issueId, depId);
    },
    onSuccess: (_, { issueId }) => {
      qc.invalidateQueries({ queryKey: ["dependencies", workspaceId, issueId] });
    },
  });
}

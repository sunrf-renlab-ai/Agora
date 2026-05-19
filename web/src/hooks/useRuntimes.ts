"use client";
import { api } from "@/lib/api";
import type { Runtime } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useRuntimes(token: string | null, workspaceId: string | null) {
  return useQuery<Runtime[]>({
    queryKey: ["runtimes", workspaceId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listRuntimes(token!, workspaceId!) as Promise<Runtime[]>;
    },
    enabled: !!token && !!workspaceId,
  });
}

export function useDeleteRuntime(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.deleteRuntime(token!, workspaceId!, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runtimes", workspaceId] });
    },
  });
}

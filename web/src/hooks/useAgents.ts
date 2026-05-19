"use client";
import { api } from "@/lib/api";
import type { Agent } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useAgents(token: string | null, workspaceId: string | null) {
  return useQuery<Agent[]>({
    queryKey: ["agents", workspaceId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listAgents(token!, workspaceId!) as Promise<Agent[]>;
    },
    enabled: !!token && !!workspaceId,
  });
}

export function useAgent(token: string | null, workspaceId: string | null, id: string | null) {
  return useQuery<Agent>({
    queryKey: ["agent", workspaceId, id],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.getAgent(token!, workspaceId!, id!) as Promise<Agent>;
    },
    enabled: !!token && !!workspaceId && !!id,
  });
}

export function useCreateAgent(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.createAgent(token!, workspaceId!, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", workspaceId] });
    },
  });
}

export function useUpdateAgent(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.updateAgent(token!, workspaceId!, id, data);
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["agents", workspaceId] });
      qc.invalidateQueries({ queryKey: ["agent", workspaceId, id] });
    },
  });
}

export function useArchiveAgent(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.archiveAgent(token!, workspaceId!, id);
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["agents", workspaceId] });
      qc.invalidateQueries({ queryKey: ["agent", workspaceId, id] });
    },
  });
}

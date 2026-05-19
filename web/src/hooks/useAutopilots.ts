"use client";
import { api } from "@/lib/api";
import type { Autopilot, AutopilotTrigger } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface AutopilotDetail {
  autopilot: Autopilot;
  triggers: AutopilotTrigger[];
}

export function useAutopilots(token: string | null, workspaceId: string | null) {
  return useQuery<Autopilot[]>({
    queryKey: ["autopilots", workspaceId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listAutopilots(token!, workspaceId!) as Promise<Autopilot[]>;
    },
    enabled: !!token && !!workspaceId,
  });
}

export function useAutopilot(token: string | null, workspaceId: string | null, id: string | null) {
  return useQuery<AutopilotDetail>({
    queryKey: ["autopilot", workspaceId, id],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.getAutopilot(token!, workspaceId!, id!) as Promise<AutopilotDetail>;
    },
    enabled: !!token && !!workspaceId && !!id,
  });
}

export function useCreateAutopilot(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.createAutopilot(token!, workspaceId!, data) as Promise<Autopilot>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilots", workspaceId] });
    },
  });
}

export function useUpdateAutopilot(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.updateAutopilot(token!, workspaceId!, id, data);
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["autopilots", workspaceId] });
      qc.invalidateQueries({ queryKey: ["autopilot", workspaceId, id] });
    },
  });
}

export function useDeleteAutopilot(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.deleteAutopilot(token!, workspaceId!, id);
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["autopilots", workspaceId] });
      qc.invalidateQueries({ queryKey: ["autopilot", workspaceId, id] });
    },
  });
}

export function useManualTriggerAutopilot(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.manualTriggerAutopilot(token!, workspaceId!, id);
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["autopilot-runs", workspaceId, id] });
      qc.invalidateQueries({ queryKey: ["autopilot", workspaceId, id] });
    },
  });
}

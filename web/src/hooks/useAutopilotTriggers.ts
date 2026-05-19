"use client";
import { api } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useCreateTrigger(
  token: string | null,
  workspaceId: string | null,
  autopilotId: string | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when all are truthy
      return api.createTrigger(token!, workspaceId!, autopilotId!, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot", workspaceId, autopilotId] });
    },
  });
}

export function useUpdateTrigger(
  token: string | null,
  workspaceId: string | null,
  autopilotId: string | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ triggerId, data }: { triggerId: string; data: Record<string, unknown> }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when all are truthy
      return api.updateTrigger(token!, workspaceId!, autopilotId!, triggerId, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot", workspaceId, autopilotId] });
    },
  });
}

export function useDeleteTrigger(
  token: string | null,
  workspaceId: string | null,
  autopilotId: string | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (triggerId: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when all are truthy
      return api.deleteTrigger(token!, workspaceId!, autopilotId!, triggerId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot", workspaceId, autopilotId] });
    },
  });
}

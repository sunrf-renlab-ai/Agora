"use client";
import { api } from "@/lib/api";
import type { Pin, PinItemType } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function usePins(token: string | null, workspaceId: string | null) {
  return useQuery<Pin[]>({
    queryKey: ["pins", workspaceId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listPins(token!, workspaceId!) as Promise<Pin[]>;
    },
    enabled: !!token && !!workspaceId,
  });
}

export function useCreatePin(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { itemType: PinItemType; itemId: string }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.createPin(token!, workspaceId!, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pins", workspaceId] });
    },
  });
}

export function useDeletePin(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.deletePin(token!, workspaceId!, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pins", workspaceId] });
    },
  });
}

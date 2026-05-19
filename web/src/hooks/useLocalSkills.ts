"use client";
import { api } from "@/lib/api";
import type { RuntimeLocalSkillImportRequest, RuntimeLocalSkillListRequest } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useRequestLocalSkillList(
  token: string | null,
  workspaceId: string | null,
  runtimeId: string | null,
) {
  return useMutation({
    mutationFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when all are truthy
      return api.requestLocalSkillList(token!, workspaceId!, runtimeId!) as Promise<{
        requestId: string;
      }>;
    },
  });
}

export function useLocalSkillListRequest(
  token: string | null,
  workspaceId: string | null,
  runtimeId: string | null,
  requestId: string | null,
) {
  return useQuery<RuntimeLocalSkillListRequest>({
    queryKey: ["local-skill-list", workspaceId, runtimeId, requestId],
    queryFn: () => {
      return api.getLocalSkillListRequest(
        // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
        token!,
        // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
        workspaceId!,
        // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
        runtimeId!,
        // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
        requestId!,
      ) as Promise<RuntimeLocalSkillListRequest>;
    },
    enabled: !!token && !!workspaceId && !!runtimeId && !!requestId,
    refetchInterval: (q) => {
      const data = q.state.data;
      return data && data.status === "pending" ? 1000 : false;
    },
  });
}

export function useRequestLocalSkillImport(
  token: string | null,
  workspaceId: string | null,
  runtimeId: string | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      skillKey: string;
      name?: string;
      description?: string;
      visibility?: "workspace" | "public";
    }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when all are truthy
      return api.requestLocalSkillImport(token!, workspaceId!, runtimeId!, data) as Promise<{
        requestId: string;
      }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills", workspaceId] });
    },
  });
}

export function useLocalSkillImportRequest(
  token: string | null,
  workspaceId: string | null,
  runtimeId: string | null,
  requestId: string | null,
) {
  return useQuery<RuntimeLocalSkillImportRequest>({
    queryKey: ["local-skill-import", workspaceId, runtimeId, requestId],
    queryFn: () => {
      return api.getLocalSkillImportRequest(
        // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
        token!,
        // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
        workspaceId!,
        // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
        runtimeId!,
        // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
        requestId!,
      ) as Promise<RuntimeLocalSkillImportRequest>;
    },
    enabled: !!token && !!workspaceId && !!runtimeId && !!requestId,
    refetchInterval: (q) => {
      const data = q.state.data;
      return data && data.status === "pending" ? 1000 : false;
    },
  });
}

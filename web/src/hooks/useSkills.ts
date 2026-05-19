"use client";
import { api } from "@/lib/api";
import type { Skill, SkillWithFiles } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useSkills(token: string | null, workspaceId: string | null) {
  return useQuery<Skill[]>({
    queryKey: ["skills", workspaceId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listSkills(token!, workspaceId!) as Promise<Skill[]>;
    },
    enabled: !!token && !!workspaceId,
  });
}

export function useSkill(token: string | null, workspaceId: string | null, skillId: string | null) {
  return useQuery<SkillWithFiles>({
    queryKey: ["skill", workspaceId, skillId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.getSkill(token!, workspaceId!, skillId!) as Promise<SkillWithFiles>;
    },
    enabled: !!token && !!workspaceId && !!skillId,
  });
}

export function useCreateSkill(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.createSkill(token!, workspaceId!, data) as Promise<SkillWithFiles>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills", workspaceId] });
    },
  });
}

export function useUpdateSkill(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.updateSkill(token!, workspaceId!, id, data) as Promise<SkillWithFiles>;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["skills", workspaceId] });
      qc.invalidateQueries({ queryKey: ["skill", workspaceId, id] });
    },
  });
}

export function useDeleteSkill(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.deleteSkill(token!, workspaceId!, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills", workspaceId] });
    },
  });
}

export function useImportSkillUrl(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.importSkillUrl(token!, workspaceId!, url) as Promise<SkillWithFiles>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills", workspaceId] });
    },
  });
}

export function useAgentSkills(
  token: string | null,
  workspaceId: string | null,
  agentId: string | null,
) {
  return useQuery<Skill[]>({
    queryKey: ["agent-skills", workspaceId, agentId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listAgentSkills(token!, workspaceId!, agentId!) as Promise<Skill[]>;
    },
    enabled: !!token && !!workspaceId && !!agentId,
  });
}

export function useSetAgentSkills(
  token: string | null,
  workspaceId: string | null,
  agentId: string | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when all are truthy
      return api.setAgentSkills(token!, workspaceId!, agentId!, skillIds) as Promise<Skill[]>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-skills", workspaceId, agentId] });
    },
  });
}

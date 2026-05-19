"use client";
import { api } from "@/lib/api";
import type { Project, ProjectResource } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type ProjectWithResources = Project & { resources: ProjectResource[] };

export function useProjects(token: string | null, workspaceId: string | null) {
  return useQuery<Project[]>({
    queryKey: ["projects", workspaceId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listProjects(token!, workspaceId!) as Promise<Project[]>;
    },
    enabled: !!token && !!workspaceId,
  });
}

export function useProject(
  token: string | null,
  workspaceId: string | null,
  projectId: string | null,
) {
  return useQuery<ProjectWithResources>({
    queryKey: ["project", workspaceId, projectId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.getProject(token!, workspaceId!, projectId!) as Promise<ProjectWithResources>;
    },
    enabled: !!token && !!workspaceId && !!projectId,
  });
}

export function useCreateProject(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.createProject(token!, workspaceId!, data) as Promise<Project>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", workspaceId] });
    },
  });
}

export function useUpdateProject(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.updateProject(token!, workspaceId!, id, data);
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["projects", workspaceId] });
      qc.invalidateQueries({ queryKey: ["project", workspaceId, id] });
    },
  });
}

export function useDeleteProject(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.deleteProject(token!, workspaceId!, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", workspaceId] });
    },
  });
}

export function useAddProjectResource(
  token: string | null,
  workspaceId: string | null,
  projectId: string | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      return api.addProjectResource(
        // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when all are truthy
        token!,
        // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when all are truthy
        workspaceId!,
        // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when all are truthy
        projectId!,
        data,
      ) as Promise<ProjectResource>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", workspaceId, projectId] });
    },
  });
}

export function useRemoveProjectResource(
  token: string | null,
  workspaceId: string | null,
  projectId: string | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when all are truthy
      return api.removeProjectResource(token!, workspaceId!, projectId!, resourceId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", workspaceId, projectId] });
    },
  });
}

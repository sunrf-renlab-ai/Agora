"use client";
import { api } from "@/lib/api";
import type { KnowledgeDoc, KnowledgeKind, WSMessage } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWSChannel } from "./useWSChannel";

const listKey = (wsId: string | null, projectId: string | null) =>
  ["knowledge", wsId, projectId] as const;
const docKey = (wsId: string | null, id: string | null) => ["knowledge", wsId, "doc", id] as const;

/**
 * @param projectId  null = all docs (workspace + every project),
 *                   "ws"  = workspace-wide only,
 *                   <uuid> = that project's docs + workspace-wide
 */
export function useKnowledgeDocs(
  token: string | null,
  workspaceId: string | null,
  projectId: string | null = null,
) {
  const qc = useQueryClient();
  const q = useQuery<KnowledgeDoc[]>({
    queryKey: listKey(workspaceId, projectId),
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled gate
      return api.listKnowledge(token!, workspaceId!, projectId ?? undefined) as Promise<
        KnowledgeDoc[]
      >;
    },
    enabled: !!token && !!workspaceId,
  });
  // Cross-tab refresh on knowledge.* events. Invalidate ALL scopes for
  // this workspace since a doc's projectId can change via update.
  useWSChannel(workspaceId, (msg: WSMessage) => {
    if (msg.event.type.startsWith("knowledge.")) {
      qc.invalidateQueries({ queryKey: ["knowledge", workspaceId] });
    }
  });
  return q;
}

export function useKnowledgeDoc(
  token: string | null,
  workspaceId: string | null,
  docId: string | null,
) {
  return useQuery<KnowledgeDoc>({
    queryKey: docKey(workspaceId, docId),
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled gate
      return api.getKnowledge(token!, workspaceId!, docId!) as Promise<KnowledgeDoc>;
    },
    enabled: !!token && !!workspaceId && !!docId,
  });
}

export function useCreateKnowledge(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      kind: KnowledgeKind;
      title: string;
      content: string;
      projectId?: string | null;
    }) => {
      // biome-ignore lint/style/noNonNullAssertion: gate
      return api.createKnowledge(token!, workspaceId!, data) as Promise<KnowledgeDoc>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge", workspaceId] }),
  });
}

export function useUpdateKnowledge(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      docId,
      data,
    }: {
      docId: string;
      data: Partial<{ kind: KnowledgeKind; title: string; content: string; projectId: string | null }>;
    }) => {
      // biome-ignore lint/style/noNonNullAssertion: gate
      return api.updateKnowledge(token!, workspaceId!, docId, data) as Promise<KnowledgeDoc>;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["knowledge", workspaceId] });
      qc.invalidateQueries({ queryKey: docKey(workspaceId, d.id) });
    },
  });
}

export function useDeleteKnowledge(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => {
      // biome-ignore lint/style/noNonNullAssertion: gate
      return api.deleteKnowledge(token!, workspaceId!, docId) as Promise<void>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge", workspaceId] }),
  });
}

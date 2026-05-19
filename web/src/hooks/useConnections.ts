"use client";
import { api, ApiError } from "@/lib/api";
import type { ConnectionKind, ConnectionStatus, UserConnection } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useMyConnections(token: string | null) {
  return useQuery<{ kinds: UserConnection[] }>({
    queryKey: ["my-connections"],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled gate
      return api.listMyConnections(token!) as Promise<{ kinds: UserConnection[] }>;
    },
    enabled: !!token,
  });
}

export interface WorkspaceConnectionMember {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  connections: { kind: ConnectionKind; status: ConnectionStatus; connectedAt: string | null }[];
}

/** Aggregate of all workspace members' connections. Used by the
 *  /knowledge "team data sources" panel. Read-only; the per-user
 *  Connect / Disconnect lives on /settings/connections. */
export function useWorkspaceConnections(token: string | null, workspaceId: string | null) {
  return useQuery<{ members: WorkspaceConnectionMember[] }>({
    queryKey: ["workspace-connections", workspaceId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled gate
      return api.listWorkspaceConnections(token!, workspaceId!) as Promise<{
        members: WorkspaceConnectionMember[];
      }>;
    },
    enabled: !!token && !!workspaceId,
  });
}

/**
 * Start the OAuth flow for a provider. Resolves to the provider's
 * authorize URL on success — caller should `window.location =` it.
 *
 * Returns a special `not_configured` flag (mapping to the server's
 * 503 "OAuth not configured for kind") so the UI can show the existing
 * stub modal explaining the env vars need to be set on Render.
 */
export function useStartConnection(token: string | null) {
  return useMutation<
    { authorizeUrl: string } | { notConfigured: true; message: string },
    Error,
    ConnectionKind
  >({
    mutationFn: async (kind: ConnectionKind) => {
      try {
        // biome-ignore lint/style/noNonNullAssertion: gate
        const r = (await api.startConnection(token!, kind)) as { authorizeUrl: string };
        return r;
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          return { notConfigured: true, message: e.message };
        }
        throw e;
      }
    },
  });
}

export function useDisconnect(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: ConnectionKind) => {
      // biome-ignore lint/style/noNonNullAssertion: gate
      return api.disconnectConnection(token!, kind);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-connections"] }),
  });
}

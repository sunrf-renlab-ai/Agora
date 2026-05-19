"use client";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export interface Member {
  id: string;
  userId: string;
  workspaceId: string;
  role: "owner" | "admin" | "member";
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
}

export function useMembers(token: string | null, workspaceId: string | null) {
  return useQuery<Member[]>({
    queryKey: ["members", workspaceId],
    queryFn: () => api.listMembers(token as string, workspaceId as string) as Promise<Member[]>,
    enabled: !!token && !!workspaceId,
  });
}

"use client";
import { api } from "@/lib/api";
import type { AutopilotRun } from "@agora/shared";
import { useQuery } from "@tanstack/react-query";

export function useAutopilotRuns(
  token: string | null,
  workspaceId: string | null,
  autopilotId: string | null,
) {
  return useQuery<AutopilotRun[]>({
    queryKey: ["autopilot-runs", workspaceId, autopilotId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listAutopilotRuns(token!, workspaceId!, autopilotId!) as Promise<AutopilotRun[]>;
    },
    enabled: !!token && !!workspaceId && !!autopilotId,
  });
}

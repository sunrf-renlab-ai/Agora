"use client";
import { api } from "@/lib/api";
import type { NotificationPreferences } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useNotificationPreferences(token: string | null) {
  return useQuery<NotificationPreferences>({
    queryKey: ["notification-preferences"],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures token is truthy
      return api.getNotificationPreferences(token!) as Promise<NotificationPreferences>;
    },
    enabled: !!token,
  });
}

export function useUpdateNotificationPreferences(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Record<string, unknown>) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn called only when token is truthy
      return api.updateNotificationPreferences(token!, prefs);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
  });
}

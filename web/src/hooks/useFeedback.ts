"use client";
import { api } from "@/lib/api";
import type { Feedback } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useMyFeedback(token: string | null) {
  return useQuery<Feedback[]>({
    queryKey: ["feedback", "mine"],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures token is truthy
      return api.listMyFeedback(token!) as Promise<Feedback[]>;
    },
    enabled: !!token,
  });
}

export function useSubmitFeedback(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn called only when token is truthy
      return api.submitFeedback(token!, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedback", "mine"] });
    },
  });
}

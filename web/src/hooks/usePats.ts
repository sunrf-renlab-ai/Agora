"use client";
import { api } from "@/lib/api";
import type { PersonalAccessToken, PersonalAccessTokenWithCleartext } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function usePats(token: string | null) {
  return useQuery<PersonalAccessToken[]>({
    queryKey: ["pats"],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures token is truthy
      return api.listPats(token!) as Promise<PersonalAccessToken[]>;
    },
    enabled: !!token,
  });
}

export function useCreatePat(token: string | null) {
  const qc = useQueryClient();
  return useMutation<
    PersonalAccessTokenWithCleartext,
    Error,
    { name: string; expiresAt?: string | null }
  >({
    mutationFn: (data) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn called only when token is truthy
      return api.createPat(token!, data) as Promise<PersonalAccessTokenWithCleartext>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pats"] });
    },
  });
}

export function useRevokePat(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn called only when token is truthy
      return api.revokePat(token!, tokenId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pats"] });
    },
  });
}

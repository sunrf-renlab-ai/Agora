"use client";
import { api } from "@/lib/api";
import type { Attachment, AttachmentOwnerKind } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useAttachments(
  token: string | null,
  workspaceId: string | null,
  ownerKind: AttachmentOwnerKind | null,
  ownerId: string | null,
) {
  return useQuery<Attachment[]>({
    queryKey: ["attachments", workspaceId, ownerKind, ownerId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listAttachments(token!, workspaceId!, ownerKind!, ownerId!) as Promise<
        Attachment[]
      >;
    },
    enabled: !!token && !!workspaceId && !!ownerKind && !!ownerId,
  });
}

export function useUploadAttachment(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      ownerKind,
      ownerId,
    }: {
      file: File;
      ownerKind: AttachmentOwnerKind;
      ownerId: string;
    }) => {
      // Step 1: ask the server for a signed upload URL
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      const sign = (await api.signAttachmentUpload(token!, workspaceId!, {
        ownerKind,
        ownerId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      })) as { uploadUrl: string; storageKey: string };

      // Step 2: PUT the file directly into the bucket via the signed URL
      const putRes = await fetch(sign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);

      // Step 3: record the metadata
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.recordAttachment(token!, workspaceId!, {
        ownerKind,
        ownerId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        storageKey: sign.storageKey,
      });
    },
    onSuccess: (_, { ownerKind, ownerId }) => {
      qc.invalidateQueries({ queryKey: ["attachments", workspaceId, ownerKind, ownerId] });
    },
  });
}

export function useDeleteAttachment(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.deleteAttachment(token!, workspaceId!, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments", workspaceId] });
    },
  });
}

// Not a hook — a plain async helper. Named without `use` prefix so React's
// rules-of-hooks doesn't flag the call site.
export async function fetchAttachmentDownloadUrl(
  token: string,
  workspaceId: string,
  id: string,
): Promise<{ url: string; filename: string }> {
  const res = (await api.getAttachmentDownloadUrl(token, workspaceId, id)) as {
    url: string;
    filename: string;
  };
  return { url: res.url, filename: res.filename };
}

"use client";
import {
  fetchAttachmentDownloadUrl,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from "@/hooks/useAttachments";
import type { AttachmentOwnerKind } from "@agora/shared";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

export function AttachmentList({
  token,
  workspaceId,
  ownerKind,
  ownerId,
  currentUserId,
}: {
  token: string;
  workspaceId: string;
  ownerKind: AttachmentOwnerKind;
  ownerId: string;
  currentUserId: string;
}) {
  const list = useAttachments(token, workspaceId, ownerKind, ownerId);
  const upload = useUploadAttachment(token, workspaceId);
  const del = useDeleteAttachment(token, workspaceId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const t = useTranslations("issueDetail.attachmentList");

  const handleDownload = async (id: string) => {
    const { url } = await fetchAttachmentDownloadUrl(token, workspaceId, id);
    window.open(url, "_blank");
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      upload.mutate({ file: f, ownerKind, ownerId });
    }
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`rounded border-2 border-dashed p-3 text-center text-xs ${
          drag ? "border-indigo-500 bg-indigo-50" : "border-gray-300"
        }`}
      >
        <label htmlFor={`file-input-${ownerId}`} className="sr-only">
          Choose attachment file
        </label>
        <input
          ref={inputRef}
          id={`file-input-${ownerId}`}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          type="button"
          className="text-indigo-600 hover:underline"
          onClick={() => inputRef.current?.click()}
        >
          {t("chooseFiles")}
        </button>{" "}
        <span className="text-gray-500">{t("orDropHere")}</span>
        {upload.isPending ? <div className="mt-1 text-gray-500">Uploading…</div> : null}
        {upload.isError ? (
          <div className="mt-1 text-red-600">{(upload.error as Error).message}</div>
        ) : null}
      </div>
      <ul className="space-y-1">
        {(list.data ?? []).map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between rounded border border-gray-200 px-2 py-1 text-xs"
          >
            <span className="truncate text-gray-700">
              {a.filename} <span className="text-gray-400">({(a.size / 1024).toFixed(1)} KB)</span>
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => handleDownload(a.id)}
                className="text-indigo-600 hover:underline"
              >
                download
              </button>
              {a.createdByUserId === currentUserId ? (
                <button
                  type="button"
                  onClick={() => del.mutate(a.id)}
                  className="text-red-600 hover:underline"
                >
                  delete
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";
import {
  useLocalSkillImportRequest,
  useLocalSkillListRequest,
  useRequestLocalSkillImport,
  useRequestLocalSkillList,
} from "@/hooks/useLocalSkills";
import { useRuntimes } from "@/hooks/useRuntimes";
import { useEffect, useRef, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | null;
  workspaceId: string | null;
  onImported?: (skillId: string) => void;
}

export function ImportFromLocalDialog({ open, onClose, token, workspaceId, onImported }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [runtimeId, setRuntimeId] = useState<string>("");
  const [scanRequestId, setScanRequestId] = useState<string | null>(null);
  const [importRequestId, setImportRequestId] = useState<string | null>(null);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: runtimes = [] } = useRuntimes(token, workspaceId);
  const requestList = useRequestLocalSkillList(token, workspaceId, runtimeId || null);
  const requestImport = useRequestLocalSkillImport(token, workspaceId, runtimeId || null);
  const listResult = useLocalSkillListRequest(token, workspaceId, runtimeId || null, scanRequestId);
  const importResult = useLocalSkillImportRequest(
    token,
    workspaceId,
    runtimeId || null,
    importRequestId,
  );

  useEffect(() => {
    if (!open) {
      handleClose();
    }
  }, [open]);

  // Auto-pick the first online runtime
  useEffect(() => {
    if (runtimeId) return;
    const online = runtimes.find((r) => r.online);
    if (online) setRuntimeId(online.id);
    else if (runtimes.length > 0) setRuntimeId(runtimes[0]?.id ?? "");
  }, [runtimes, runtimeId]);

  // When import completes successfully, surface skillId
  useEffect(() => {
    const data = importResult.data;
    if (!data) return;
    if (data.status === "completed" && data.skillId) {
      setImportingKey(null);
      if (onImported) onImported(data.skillId);
    } else if (data.status === "failed") {
      setImportingKey(null);
      setError(data.error || "Import failed");
    }
  }, [importResult.data, onImported]);

  async function handleScan() {
    setError(null);
    setScanRequestId(null);
    if (!runtimeId) return;
    try {
      const res = await requestList.mutateAsync();
      setScanRequestId(res.requestId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleImport(skillKey: string, name: string, description: string) {
    setError(null);
    setImportingKey(skillKey);
    try {
      const res = await requestImport.mutateAsync({ skillKey, name, description });
      setImportRequestId(res.requestId);
    } catch (e) {
      setError((e as Error).message);
      setImportingKey(null);
    }
  }

  function handleClose() {
    setScanRequestId(null);
    setImportRequestId(null);
    setImportingKey(null);
    setError(null);
    onClose();
  }

  const list = listResult.data;
  const isPending = list?.status === "pending";
  const isFailed = list?.status === "failed";
  const isCompleted = list?.status === "completed";

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={handleClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") handleClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        // biome-ignore lint/a11y/useSemanticElements: native <dialog open> uses fixed positioning that conflicts with parent flex centering
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-modal="true"
        aria-label="Import skill from local runtime"
        className="rounded-lg shadow-xl bg-white p-0"
      >
        <div className="p-6 w-[640px] max-w-full space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Import skill from local runtime</h2>
            <p className="text-xs text-gray-500 mt-1">
              Pick a runtime and scan its installed skills. Local files will be uploaded.
            </p>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label
                htmlFor="local-runtime"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Runtime
              </label>
              <select
                id="local-runtime"
                aria-label="Runtime"
                value={runtimeId}
                onChange={(e) => {
                  setRuntimeId(e.target.value);
                  setScanRequestId(null);
                }}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">Select a runtime…</option>
                {runtimes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.online ? "" : "(offline)"}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleScan}
              disabled={!runtimeId || requestList.isPending || isPending}
              className="px-3 py-2 text-sm bg-indigo-600 text-white rounded font-medium disabled:opacity-60"
            >
              {requestList.isPending || isPending ? "Scanning…" : "Scan"}
            </button>
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          {scanRequestId && isPending && (
            <div className="text-sm text-gray-500">Waiting for runtime to respond…</div>
          )}
          {scanRequestId && isFailed && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              Scan failed: {list?.error || "unknown error"}
            </div>
          )}
          {scanRequestId && isCompleted && list && list.skills.length === 0 && (
            <div className="text-sm text-gray-500">No local skills found.</div>
          )}
          {scanRequestId && isCompleted && list && list.skills.length > 0 && (
            <div className="border rounded max-h-[320px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Name</th>
                    <th className="text-left px-3 py-2 font-medium">Provider</th>
                    <th className="text-left px-3 py-2 font-medium">Files</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {list.skills.map((s) => {
                    const isThisImporting = importingKey === s.key;
                    return (
                      <tr key={s.key} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium">{s.name || s.key}</div>
                          {s.description && (
                            <div className="text-xs text-gray-500">{s.description}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">{s.provider || "-"}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{s.fileCount}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleImport(s.key, s.name, s.description)}
                            disabled={isThisImporting || importingKey !== null}
                            className="px-2 py-1 text-xs bg-indigo-600 text-white rounded disabled:opacity-60"
                          >
                            {isThisImporting ? "Importing…" : "Import"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-3 py-1.5 text-sm text-gray-600 border rounded hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

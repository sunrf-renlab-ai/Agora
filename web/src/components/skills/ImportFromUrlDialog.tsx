"use client";
import { useImportSkillUrl } from "@/hooks/useSkills";
import { useEffect, useRef, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | null;
  workspaceId: string | null;
  onImported?: (skillId: string) => void;
}

export function ImportFromUrlDialog({ open, onClose, token, workspaceId, onImported }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const importMutation = useImportSkillUrl(token, workspaceId);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const skill = await importMutation.mutateAsync(url.trim());
      const out = skill as { id?: string };
      setUrl("");
      onClose();
      if (out.id && onImported) onImported(out.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
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
        aria-label="Import skill from URL"
        className="rounded-lg shadow-xl bg-white p-0"
      >
        <form onSubmit={handleSubmit} className="p-6 w-[480px] space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Import skill from URL</h2>
            <p className="text-xs text-gray-500 mt-1">
              Paste a SKILL.md URL or a directory listing for a skill.
            </p>
          </div>

          <div>
            <label htmlFor="import-url" className="block text-sm font-medium text-gray-700 mb-1">
              URL
            </label>
            <input
              id="import-url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/SKILL.md"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-600 border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={importMutation.isPending || !url.trim()}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded font-medium disabled:opacity-60"
            >
              {importMutation.isPending ? "Importing…" : "Import"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

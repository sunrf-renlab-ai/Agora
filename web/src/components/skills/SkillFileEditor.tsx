"use client";
import { useState } from "react";

export interface SkillFileEntry {
  path: string;
  content: string;
}

interface Props {
  files: SkillFileEntry[];
  onChange: (next: SkillFileEntry[]) => void;
}

export function SkillFileEditor({ files, onChange }: Props) {
  const [selected, setSelected] = useState(0);
  const safeIndex = Math.min(selected, Math.max(0, files.length - 1));
  const current = files[safeIndex];

  function updateFile(index: number, patch: Partial<SkillFileEntry>) {
    const next = files.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange(next);
  }

  function addFile() {
    const next = [...files, { path: "", content: "" }];
    onChange(next);
    setSelected(next.length - 1);
  }

  function removeFile(index: number) {
    const next = files.filter((_, i) => i !== index);
    onChange(next);
    if (safeIndex >= next.length) setSelected(Math.max(0, next.length - 1));
  }

  return (
    <div className="grid grid-cols-[200px_1fr] gap-3 border rounded">
      <div className="border-r bg-gray-50 p-2 flex flex-col gap-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-700">Files</span>
          <button
            type="button"
            onClick={addFile}
            className="text-xs text-indigo-600 hover:underline"
          >
            + Add
          </button>
        </div>
        {files.length === 0 ? (
          <div className="text-xs text-gray-400">No extra files</div>
        ) : (
          files.map((f, i) => (
            <div
              key={`${f.path}-${i}`}
              className={`flex items-center justify-between gap-1 text-xs px-2 py-1 rounded ${
                i === safeIndex ? "bg-white border" : "hover:bg-white"
              }`}
            >
              <button
                type="button"
                onClick={() => setSelected(i)}
                className="flex-1 text-left truncate"
                title={f.path || "(unnamed)"}
              >
                {f.path || "(unnamed)"}
              </button>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="text-red-500 hover:text-red-700"
                aria-label={`Remove ${f.path || "file"}`}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className="p-2 space-y-2">
        {current ? (
          <>
            <input
              type="text"
              value={current.path}
              onChange={(e) => updateFile(safeIndex, { path: e.target.value })}
              placeholder="path/to/file.md"
              aria-label="File path"
              className="w-full border rounded px-2 py-1 text-sm font-mono"
            />
            <textarea
              value={current.content}
              onChange={(e) => updateFile(safeIndex, { content: e.target.value })}
              placeholder="File contents…"
              rows={14}
              aria-label="File contents"
              className="w-full border rounded px-2 py-1 text-sm font-mono resize-y"
            />
          </>
        ) : (
          <div className="text-sm text-gray-400 p-4">No file selected.</div>
        )}
      </div>
    </div>
  );
}

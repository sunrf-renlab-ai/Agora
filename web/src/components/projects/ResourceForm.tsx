"use client";
import type { ProjectResourceType } from "@agora/shared";
import { useState } from "react";

const RESOURCE_TYPES: ProjectResourceType[] = ["repo", "url", "doc"];

interface Props {
  onSubmit: (data: {
    resourceType: ProjectResourceType;
    resourceRef: string;
    label: string | null;
  }) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

export function ResourceForm({ onSubmit, isLoading, error }: Props) {
  const [resourceType, setResourceType] = useState<ProjectResourceType>("repo");
  const [resourceRef, setResourceRef] = useState("");
  const [label, setLabel] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!resourceRef.trim()) return;
    await onSubmit({
      resourceType,
      resourceRef: resourceRef.trim(),
      label: label.trim() || null,
    });
    setResourceRef("");
    setLabel("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-end border rounded p-3">
      <div>
        <label htmlFor="resource-type" className="block text-xs font-medium text-gray-700 mb-1">
          Type
        </label>
        <select
          id="resource-type"
          aria-label="Resource type"
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value as ProjectResourceType)}
          className="border rounded px-2 py-1.5 text-sm"
        >
          {RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-w-[200px]">
        <label htmlFor="resource-ref" className="block text-xs font-medium text-gray-700 mb-1">
          Reference
        </label>
        <input
          id="resource-ref"
          type="text"
          required
          value={resourceRef}
          onChange={(e) => setResourceRef(e.target.value)}
          placeholder="github.com/owner/repo or https://…"
          className="w-full border rounded px-2 py-1.5 text-sm"
        />
      </div>

      <div className="flex-1 min-w-[160px]">
        <label htmlFor="resource-label" className="block text-xs font-medium text-gray-700 mb-1">
          Label (optional)
        </label>
        <input
          id="resource-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Friendly name"
          className="w-full border rounded px-2 py-1.5 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded font-medium disabled:opacity-60"
      >
        {isLoading ? "Adding…" : "Add"}
      </button>

      {error && (
        <div className="w-full px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}
    </form>
  );
}

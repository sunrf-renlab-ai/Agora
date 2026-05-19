"use client";
import type { Project } from "@agora/shared";
import { useState } from "react";

const STATUSES = ["planning", "active", "paused", "completed", "archived"] as const;
const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;

interface ProjectFormValues {
  title: string;
  description: string;
  status: (typeof STATUSES)[number];
  priority: (typeof PRIORITIES)[number];
}

interface Props {
  initial?: Project;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function ProjectForm({ initial, onSubmit, onCancel, isLoading, error }: Props) {
  const [values, setValues] = useState<ProjectFormValues>({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    status: initial?.status ?? "active",
    priority: initial?.priority ?? "none",
  });

  function set<K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit({
      title: values.title,
      description: values.description || null,
      status: values.status,
      priority: values.priority,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      <div>
        <label htmlFor="project-title" className="block text-sm font-medium text-gray-700 mb-1">
          Title
        </label>
        <input
          id="project-title"
          type="text"
          required
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="My Project"
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label
          htmlFor="project-description"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Description
        </label>
        <textarea
          id="project-description"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What this project is about…"
          rows={4}
          className="w-full border rounded px-3 py-2 text-sm resize-y"
        />
      </div>

      <div>
        <label htmlFor="project-status" className="block text-sm font-medium text-gray-700 mb-1">
          Status
        </label>
        <select
          id="project-status"
          aria-label="Status"
          value={values.status}
          onChange={(e) => set("status", e.target.value as ProjectFormValues["status"])}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="project-priority" className="block text-sm font-medium text-gray-700 mb-1">
          Priority
        </label>
        <select
          id="project-priority"
          aria-label="Priority"
          value={values.priority}
          onChange={(e) => set("priority", e.target.value as ProjectFormValues["priority"])}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded font-medium disabled:opacity-60"
        >
          {isLoading ? "Saving…" : initial ? "Update Project" : "Create Project"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 border rounded hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

"use client";
import { useAgents } from "@/hooks/useAgents";
import type { Autopilot } from "@agora/shared";
import { useState } from "react";

const EXECUTION_MODES = ["create_issue", "run_only"] as const;

interface AutopilotFormValues {
  title: string;
  description: string;
  assigneeId: string;
  executionMode: "create_issue" | "run_only";
  issueTitleTemplate: string;
}

interface Props {
  initial?: Autopilot;
  token: string | null;
  workspaceId: string | null;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function AutopilotForm({
  initial,
  token,
  workspaceId,
  onSubmit,
  onCancel,
  isLoading,
  error,
}: Props) {
  const { data: agents = [] } = useAgents(token, workspaceId);
  const [values, setValues] = useState<AutopilotFormValues>({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    assigneeId: initial?.assigneeId ?? "",
    executionMode: initial?.executionMode ?? "create_issue",
    issueTitleTemplate: initial?.issueTitleTemplate ?? "",
  });

  function set<K extends keyof AutopilotFormValues>(key: K, value: AutopilotFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit({
      title: values.title,
      description: values.description || null,
      assigneeId: values.assigneeId,
      executionMode: values.executionMode,
      issueTitleTemplate: values.issueTitleTemplate || null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      <div>
        <label htmlFor="autopilot-title" className="block text-sm font-medium text-gray-700 mb-1">
          Title
        </label>
        <input
          id="autopilot-title"
          type="text"
          required
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Daily standup summary"
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label
          htmlFor="autopilot-description"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Description
        </label>
        <textarea
          id="autopilot-description"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What this autopilot does…"
          rows={3}
          className="w-full border rounded px-3 py-2 text-sm resize-y"
        />
      </div>

      <div>
        <label
          htmlFor="autopilot-assignee"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Assignee Agent
        </label>
        <select
          id="autopilot-assignee"
          aria-label="Assignee Agent"
          required
          value={values.assigneeId}
          onChange={(e) => set("assigneeId", e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          <option value="">Select an agent…</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="autopilot-execution-mode"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Execution Mode
        </label>
        <select
          id="autopilot-execution-mode"
          aria-label="Execution Mode"
          value={values.executionMode}
          onChange={(e) => set("executionMode", e.target.value as "create_issue" | "run_only")}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          {EXECUTION_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="autopilot-issue-title-template"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Issue Title Template <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="autopilot-issue-title-template"
          type="text"
          value={values.issueTitleTemplate}
          onChange={(e) => set("issueTitleTemplate", e.target.value)}
          placeholder="e.g. Daily standup {{date}}"
          className="w-full border rounded px-3 py-2 text-sm"
        />
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
          {isLoading ? "Saving…" : initial ? "Update Autopilot" : "Create Autopilot"}
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

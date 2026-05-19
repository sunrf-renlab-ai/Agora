"use client";
import type { Agent, CliKind } from "@agora/shared";
import { CLI_KINDS, CLI_LABELS } from "@agora/shared";
import { useState } from "react";

const VISIBILITY_OPTIONS = ["workspace", "private"] as const;

interface AgentFormValues {
  name: string;
  description: string;
  instructions: string;
  cliKind: CliKind;
  visibility: "workspace" | "private";
  model: string;
}

interface Props {
  initial?: Agent;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
}

export function AgentForm({ initial, onSubmit, onCancel, isLoading }: Props) {
  const [values, setValues] = useState<AgentFormValues>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    instructions: initial?.instructions ?? "",
    cliKind: initial?.cliKind ?? "claude_code",
    visibility: initial?.visibility ?? "workspace",
    model: initial?.model ?? "",
  });

  function set<K extends keyof AgentFormValues>(key: K, value: AgentFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit({
      name: values.name,
      description: values.description,
      instructions: values.instructions,
      cliKind: values.cliKind,
      visibility: values.visibility,
      model: values.model || null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      <div>
        <label htmlFor="agent-name" className="block text-sm font-medium text-gray-700 mb-1">
          Name
        </label>
        <input
          id="agent-name"
          type="text"
          required
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="My Agent"
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="agent-description" className="block text-sm font-medium text-gray-700 mb-1">
          Description
        </label>
        <input
          id="agent-description"
          type="text"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What this agent does"
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label
          htmlFor="agent-instructions"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Instructions
        </label>
        <textarea
          id="agent-instructions"
          value={values.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          placeholder="System prompt / instructions for the agent…"
          rows={6}
          className="w-full border rounded px-3 py-2 text-sm resize-y"
        />
      </div>

      <div>
        <label htmlFor="agent-cli-kind" className="block text-sm font-medium text-gray-700 mb-1">
          CLI Kind
        </label>
        <select
          id="agent-cli-kind"
          aria-label="CLI Kind"
          value={values.cliKind}
          onChange={(e) => set("cliKind", e.target.value as CliKind)}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          {CLI_KINDS.map((k) => (
            <option key={k} value={k}>
              {CLI_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="agent-visibility" className="block text-sm font-medium text-gray-700 mb-1">
          Visibility
        </label>
        <select
          id="agent-visibility"
          aria-label="Visibility"
          value={values.visibility}
          onChange={(e) => set("visibility", e.target.value as "workspace" | "private")}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          {VISIBILITY_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="agent-model" className="block text-sm font-medium text-gray-700 mb-1">
          Model <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="agent-model"
          type="text"
          value={values.model}
          onChange={(e) => set("model", e.target.value)}
          placeholder="e.g. claude-opus-4-5"
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded font-medium disabled:opacity-60"
        >
          {isLoading ? "Saving…" : initial ? "Update Agent" : "Create Agent"}
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

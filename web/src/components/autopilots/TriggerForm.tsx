"use client";
import type { TriggerKind } from "@agora/shared";
import { useState } from "react";

const TRIGGER_KINDS: TriggerKind[] = ["schedule", "webhook", "api"];

interface TriggerFormValues {
  kind: TriggerKind;
  cronExpression: string;
  timezone: string;
  label: string;
}

interface Props {
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function TriggerForm({ onSubmit, onCancel, isLoading, error }: Props) {
  const [values, setValues] = useState<TriggerFormValues>({
    kind: "schedule",
    cronExpression: "",
    timezone: "UTC",
    label: "",
  });

  function set<K extends keyof TriggerFormValues>(key: K, value: TriggerFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data: Record<string, unknown> = {
      kind: values.kind,
      label: values.label || null,
    };
    if (values.kind === "schedule") {
      data.cronExpression = values.cronExpression;
      data.timezone = values.timezone || "UTC";
    }
    await onSubmit(data);
  }

  const isSchedule = values.kind === "schedule";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="trigger-kind" className="block text-sm font-medium text-gray-700 mb-1">
          Kind
        </label>
        <select
          id="trigger-kind"
          aria-label="Trigger Kind"
          value={values.kind}
          onChange={(e) => set("kind", e.target.value as TriggerKind)}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          {TRIGGER_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      {isSchedule && (
        <>
          <div>
            <label htmlFor="trigger-cron" className="block text-sm font-medium text-gray-700 mb-1">
              Cron Expression
            </label>
            <input
              id="trigger-cron"
              type="text"
              required
              value={values.cronExpression}
              onChange={(e) => set("cronExpression", e.target.value)}
              placeholder="0 9 * * *"
              className="w-full border rounded px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              Standard cron syntax (minute hour day-of-month month day-of-week).
            </p>
          </div>

          <div>
            <label
              htmlFor="trigger-timezone"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Timezone
            </label>
            <input
              id="trigger-timezone"
              type="text"
              value={values.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              placeholder="UTC"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
        </>
      )}

      <div>
        <label htmlFor="trigger-label" className="block text-sm font-medium text-gray-700 mb-1">
          Label <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="trigger-label"
          type="text"
          value={values.label}
          onChange={(e) => set("label", e.target.value)}
          placeholder="Daily 9am"
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded font-medium disabled:opacity-60"
        >
          {isLoading ? "Saving…" : "Add Trigger"}
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

export function WebhookTokenBanner({
  cleartext,
  onDismiss,
}: {
  cleartext: string;
  onDismiss: () => void;
}) {
  return (
    <div className="p-4 bg-yellow-50 border border-yellow-300 rounded space-y-2">
      <div className="font-medium text-sm text-yellow-900">
        Webhook token (shown once — save it now)
      </div>
      <code className="block px-3 py-2 bg-white border border-yellow-200 rounded text-xs font-mono break-all">
        {cleartext}
      </code>
      <div className="flex justify-end">
        <button type="button" onClick={onDismiss} className="text-xs text-yellow-900 underline">
          I've saved it, dismiss
        </button>
      </div>
    </div>
  );
}

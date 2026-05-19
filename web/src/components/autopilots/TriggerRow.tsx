"use client";
import type { AutopilotTrigger } from "@agora/shared";

interface Props {
  trigger: AutopilotTrigger;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  isPending?: boolean;
}

export function TriggerRow({ trigger, onDelete, onToggle, isPending }: Props) {
  return (
    <div className="border rounded p-3 flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{trigger.kind}</span>
          {trigger.label && <span className="text-xs text-gray-500">· {trigger.label}</span>}
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              trigger.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
            }`}
          >
            {trigger.enabled ? "enabled" : "disabled"}
          </span>
        </div>
        {trigger.kind === "schedule" && (
          <div className="text-xs text-gray-500 font-mono mt-0.5">
            {trigger.cronExpression} ({trigger.timezone ?? "UTC"})
          </div>
        )}
        {trigger.lastFiredAt && (
          <div className="text-xs text-gray-400 mt-0.5">
            Last fired {new Date(trigger.lastFiredAt).toLocaleString()}
          </div>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onToggle(trigger.id, !trigger.enabled)}
          disabled={isPending}
          className="text-xs text-gray-600 border rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
        >
          {trigger.enabled ? "Disable" : "Enable"}
        </button>
        <button
          type="button"
          onClick={() => onDelete(trigger.id)}
          disabled={isPending}
          className="text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

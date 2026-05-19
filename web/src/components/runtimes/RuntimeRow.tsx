"use client";
import type { Runtime } from "@agora/shared";
import Link from "next/link";

interface Props {
  runtime: Runtime;
  workspaceSlug: string;
  onDelete?: (id: string) => void;
}

export function RuntimeRow({ runtime, workspaceSlug, onDelete }: Props) {
  return (
    <div className="flex items-center justify-between rounded border p-3 hover:bg-gray-50">
      <Link
        href={`/${workspaceSlug}/runtimes/${runtime.id}`}
        className="flex-1 min-w-0 block"
      >
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${runtime.online ? "bg-green-500" : "bg-gray-300"}`}
            aria-label={runtime.online ? "Online" : "Offline"}
          />
          <span className="font-medium truncate">{runtime.name}</span>
        </div>
        <div className="text-xs text-gray-500 mt-0.5 pl-4">
          v{runtime.daemonVersion}
          {runtime.detectedClis.length > 0 && (
            <span className="ml-2">
              · {runtime.detectedClis.map((c) => `${c.kind} ${c.version}`).join(", ")}
            </span>
          )}
        </div>
        {runtime.lastHeartbeatAt && (
          <div className="text-xs text-gray-400 pl-4">
            Last heartbeat: {new Date(runtime.lastHeartbeatAt).toLocaleString()}
          </div>
        )}
      </Link>

      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(runtime.id);
          }}
          className="ml-4 text-xs text-red-500 hover:text-red-700 shrink-0"
        >
          Remove
        </button>
      )}
    </div>
  );
}

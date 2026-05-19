"use client";
import type { Autopilot } from "@agora/shared";
import Link from "next/link";

export function AutopilotRow({
  autopilot,
  workspaceSlug,
}: {
  autopilot: Autopilot;
  workspaceSlug: string;
}) {
  const lastRun = autopilot.lastRunAt ? new Date(autopilot.lastRunAt).toLocaleString() : "never";
  return (
    <Link
      href={`/${workspaceSlug}/autopilots/${autopilot.id}`}
      className="flex items-center justify-between rounded border p-3 hover:bg-gray-50"
    >
      <div>
        <div className="font-medium">{autopilot.title}</div>
        <div className="text-xs text-gray-500">
          {autopilot.executionMode} · last run {lastRun}
        </div>
      </div>
      <div className="text-xs text-gray-500">{autopilot.status}</div>
    </Link>
  );
}

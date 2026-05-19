"use client";
import type { Project } from "@agora/shared";
import Link from "next/link";

export function ProjectRow({
  project,
  workspaceSlug,
}: {
  project: Project;
  workspaceSlug: string;
}) {
  return (
    <Link
      href={`/${workspaceSlug}/projects/${project.id}`}
      className="flex items-center justify-between rounded border p-3 hover:bg-gray-50"
    >
      <div>
        <div className="font-medium">{project.title}</div>
        <div className="text-xs text-gray-500">
          {project.status} · {project.priority}
        </div>
      </div>
      <div className="text-xs text-gray-500">
        {new Date(project.updatedAt).toLocaleDateString()}
      </div>
    </Link>
  );
}

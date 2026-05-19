"use client";
import { Popover } from "@/components/ui/Popover";
import { PillButton } from "@/components/ui/PillButton";
import { useProjects } from "@/hooks/useProjects";
import { Check, FolderClosed, X } from "lucide-react";
import { useState } from "react";

interface Props {
  token: string | null;
  workspaceId: string | null;
  projectId: string | null;
  onChange: (id: string | null) => void;
}

export function ProjectPicker({ token, workspaceId, projectId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const { data: projects = [] } = useProjects(token, workspaceId);
  const current = projects.find((p) => p.id === projectId) ?? null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-56 py-1"
      trigger={
        <PillButton aria-label="Set project">
          <FolderClosed className="size-3.5 text-gray-500" />
          <span>{current ? current.title : "Project"}</span>
        </PillButton>
      }
    >
      {projectId && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-gray-50"
        >
          <X className="size-3.5 text-gray-400" />
          <span className="flex-1 text-gray-500">No project</span>
        </button>
      )}
      {projects.length === 0 ? (
        <div className="px-2.5 py-2 text-xs text-gray-400">No projects yet.</div>
      ) : (
        projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onChange(p.id);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-gray-50"
          >
            <FolderClosed className="size-3.5 text-gray-500" />
            <span className="flex-1 truncate">{p.title}</span>
            {projectId === p.id && <Check className="size-3 text-gray-500" />}
          </button>
        ))
      )}
    </Popover>
  );
}

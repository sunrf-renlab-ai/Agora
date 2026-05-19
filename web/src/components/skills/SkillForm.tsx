"use client";
import { SkillFileEditor, type SkillFileEntry } from "@/components/skills/SkillFileEditor";
import type { SkillVisibility, SkillWithFiles } from "@agora/shared";
import { Globe, Lock, Users } from "lucide-react";
import { useState } from "react";

const VISIBILITY_OPTIONS: Array<{
  value: SkillVisibility;
  label: string;
  sub: string;
  icon: typeof Globe;
}> = [
  {
    value: "private",
    label: "Only you",
    sub: "no one else sees it",
    icon: Lock,
  },
  {
    value: "workspace",
    label: "Workspace",
    sub: "this workspace's members",
    icon: Users,
  },
  {
    value: "public",
    label: "Public",
    sub: "anyone on Agora",
    icon: Globe,
  },
];

interface SkillFormValues {
  name: string;
  description: string;
  content: string;
  visibility: SkillVisibility;
  files: SkillFileEntry[];
}

interface Props {
  initial?: SkillWithFiles;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  error?: string | null;
  submitLabel?: string;
}

export function SkillForm({ initial, onSubmit, onCancel, isLoading, error, submitLabel }: Props) {
  const [values, setValues] = useState<SkillFormValues>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    content: initial?.content ?? "",
    visibility: initial?.visibility ?? "workspace",
    files:
      initial?.files?.map((f) => ({ path: f.path, content: f.content })) ??
      ([] as SkillFileEntry[]),
  });

  function set<K extends keyof SkillFormValues>(key: K, value: SkillFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanFiles = values.files
      .map((f) => ({ path: f.path.trim(), content: f.content }))
      .filter((f) => f.path.length > 0);
    await onSubmit({
      name: values.name,
      description: values.description,
      content: values.content,
      visibility: values.visibility,
      files: cleanFiles,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="skill-name" className="block text-sm font-medium text-gray-700 mb-1">
          Name
        </label>
        <input
          id="skill-name"
          type="text"
          required
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="my-skill"
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="skill-description" className="block text-sm font-medium text-gray-700 mb-1">
          Description
        </label>
        <input
          id="skill-description"
          type="text"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What this skill teaches"
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>

      <div>
        <div className="block text-sm font-medium text-gray-700 mb-1">Visibility</div>
        <div
          role="radiogroup"
          aria-label="Visibility"
          className="inline-flex rounded-md border border-gray-200 overflow-hidden text-sm"
        >
          {VISIBILITY_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = values.visibility === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set("visibility", opt.value)}
                className={`inline-flex items-center gap-2 px-3 py-2 transition-colors ${
                  active ? "bg-indigo-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="flex flex-col items-start leading-tight">
                  <span className="font-medium">{opt.label}</span>
                  <span className={`text-[10px] ${active ? "text-indigo-100" : "text-gray-500"}`}>
                    {opt.sub}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="skill-content" className="block text-sm font-medium text-gray-700 mb-1">
          Content (markdown)
        </label>
        <textarea
          id="skill-content"
          value={values.content}
          onChange={(e) => set("content", e.target.value)}
          placeholder="# Skill instructions…"
          rows={14}
          className="w-full border rounded px-3 py-2 text-sm font-mono resize-y"
        />
      </div>

      <div>
        <div className="block text-sm font-medium text-gray-700 mb-1">Additional files</div>
        <SkillFileEditor files={values.files} onChange={(next) => set("files", next)} />
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
          {isLoading ? "Saving…" : (submitLabel ?? (initial ? "Update Skill" : "Create Skill"))}
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

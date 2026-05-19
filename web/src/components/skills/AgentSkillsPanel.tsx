"use client";
import { useAgentSkills, useSetAgentSkills, useSkills } from "@/hooks/useSkills";
import { useEffect, useMemo, useState } from "react";

interface Props {
  token: string | null;
  workspaceId: string | null;
  agentId: string | null;
}

export function AgentSkillsPanel({ token, workspaceId, agentId }: Props) {
  const { data: allSkills = [], isLoading: loadingSkills } = useSkills(token, workspaceId);
  const { data: bound = [], isLoading: loadingBound } = useAgentSkills(token, workspaceId, agentId);
  const setAgentSkills = useSetAgentSkills(token, workspaceId, agentId);

  const boundIds = useMemo(() => new Set(bound.map((s) => s.id)), [bound]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Sync selected when bound list changes (e.g. after fetch)
  useEffect(() => {
    setSelected(new Set(boundIds));
  }, [boundIds]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    try {
      await setAgentSkills.mutateAsync(Array.from(selected));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const dirty = useMemo(() => {
    if (selected.size !== boundIds.size) return true;
    for (const id of selected) {
      if (!boundIds.has(id)) return true;
    }
    return false;
  }, [selected, boundIds]);

  if (loadingSkills || loadingBound) {
    return <div className="text-sm text-gray-400">Loading skills…</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Skills</h2>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || setAgentSkills.isPending}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded font-medium disabled:opacity-50"
        >
          {setAgentSkills.isPending ? "Saving…" : "Save bindings"}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {allSkills.length === 0 ? (
        <div className="text-sm text-gray-400">No skills available in this workspace.</div>
      ) : (
        <ul className="space-y-1">
          {allSkills.map((s) => (
            <li key={s.id}>
              <label className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-sm font-medium">{s.name}</span>
                  {s.description && (
                    <span className="block text-xs text-gray-500">{s.description}</span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

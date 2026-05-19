"use client";
import { SkillForm } from "@/components/skills/SkillForm";
import { useDeleteSkill, useSkill, useUpdateSkill } from "@/hooks/useSkills";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

const supabase = createClient();

export default function SkillDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; skillId: string }>;
}) {
  const { workspaceSlug, skillId } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const t = data.session.access_token;
      setToken(t);
      const workspaces = await api.listWorkspaces(t);
      const ws = (workspaces as Array<{ id: string; slug: string }>).find(
        (w) => w.slug === workspaceSlug,
      );
      if (ws) setWorkspaceId(ws.id);
    });
  }, [workspaceSlug]);

  const { data: skill, isLoading } = useSkill(token, workspaceId, skillId);
  const updateSkill = useUpdateSkill(token, workspaceId);
  const deleteSkill = useDeleteSkill(token, workspaceId);

  async function handleSubmit(data: Record<string, unknown>) {
    setError(null);
    try {
      await updateSkill.mutateAsync({ id: skillId, data });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this skill? Agent bindings will also be removed.")) return;
    await deleteSkill.mutateAsync(skillId);
    router.push(`/${workspaceSlug}/skills`);
  }

  if (isLoading || !skill) {
    return <div className="p-8 text-gray-400">Loading…</div>;
  }

  return (
    <div className="p-8 max-w-3xl">
      <button
        type="button"
        onClick={() => router.push(`/${workspaceSlug}/skills`)}
        className="text-sm text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1"
      >
        ← Back to skills
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{skill.name}</h1>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteSkill.isPending}
          className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
        >
          {deleteSkill.isPending ? "Deleting…" : "Delete"}
        </button>
      </div>

      <SkillForm
        initial={skill}
        onSubmit={handleSubmit}
        isLoading={updateSkill.isPending}
        error={error}
      />
    </div>
  );
}

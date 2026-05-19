"use client";
import { ProjectForm } from "@/components/projects/ProjectForm";
import { useCreateProject } from "@/hooks/useProjects";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

const supabase = createClient();

export default function NewProjectPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
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

  const createProject = useCreateProject(token, workspaceId);

  async function handleSubmit(data: Record<string, unknown>) {
    setError(null);
    try {
      const project = (await createProject.mutateAsync(data)) as { id: string };
      router.push(`/${workspaceSlug}/projects/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="p-8 max-w-xl">
      <button
        type="button"
        onClick={() => router.push(`/${workspaceSlug}/projects`)}
        className="text-sm text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1"
      >
        ← Back to projects
      </button>
      <h1 className="text-2xl font-bold mb-6">New Project</h1>
      <ProjectForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${workspaceSlug}/projects`)}
        isLoading={createProject.isPending}
        error={error}
      />
    </div>
  );
}

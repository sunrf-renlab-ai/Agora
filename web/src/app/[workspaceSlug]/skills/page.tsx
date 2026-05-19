"use client";
import { LocalSkillsAutoScan } from "@/components/skills/LocalSkillsAutoScan";
import { useSkills } from "@/hooks/useSkills";
import { useWSChannel } from "@/hooks/useWSChannel";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { Skill, SkillVisibility, WSMessage } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Globe, Lock, Store, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";

const supabase = createClient();

type Tab = "all" | "in-use" | "unused" | "by-me";

const VISIBILITY_STYLES: Record<
  SkillVisibility,
  { label: string; icon: typeof Globe; chip: string; tip: string }
> = {
  private: {
    label: "Only you",
    icon: Lock,
    chip: "bg-gray-100 text-gray-700 border-gray-200",
    tip: "Only you can see and use this skill.",
  },
  workspace: {
    label: "Workspace",
    icon: Users,
    chip: "bg-indigo-50 text-indigo-700 border-indigo-200",
    tip: "Anyone in this workspace can install and use it.",
  },
  public: {
    label: "Public",
    icon: Globe,
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    tip: "Anyone on Agora can find and install it from the public catalog.",
  },
};

function VisibilityChip({ visibility }: { visibility: SkillVisibility }) {
  const v = VISIBILITY_STYLES[visibility];
  if (!v) return null;
  const Icon = v.icon;
  return (
    <span
      title={v.tip}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[10px] font-medium leading-none ${v.chip}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {v.label}
    </span>
  );
}

export default function SkillsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const qc = useQueryClient();
  const t = useTranslations("skills");

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const tk = data.session.access_token;
      setToken(tk);
      const [workspaces, me] = await Promise.all([api.listWorkspaces(tk), api.getMe(tk)]);
      // Use public.users.id (from /api/me), not supabase auth UUID — see agents/page.tsx.
      setUserId((me as { id: string }).id);
      const ws = (workspaces as Array<{ id: string; slug: string }>).find(
        (w) => w.slug === workspaceSlug,
      );
      if (ws) setWorkspaceId(ws.id);
    });
  }, [workspaceSlug]);

  useWSChannel(workspaceId, (msg: WSMessage) => {
    const eventType = msg.event.type;
    if (
      eventType === "skill.created" ||
      eventType === "skill.updated" ||
      eventType === "skill.deleted"
    ) {
      qc.invalidateQueries({ queryKey: ["skills", workspaceId] });
    }
  });

  const { data: skills = [], isLoading } = useSkills(token, workspaceId);

  // For now, "In Use" / "Unused" tabs hide skills until we have aggregated bindings.
  // We render All and By Me; the other two render an empty state with a hint.
  const filtered: Skill[] = useMemo(() => {
    if (tab === "all") return skills;
    if (tab === "by-me") return userId ? skills.filter((s) => s.ownerId === userId) : [];
    return [];
  }, [skills, tab, userId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h1 className="text-lg font-semibold">Skills</h1>
        <Link
          href={`/${workspaceSlug}/skills/marketplace`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-gray-700 bg-white border border-gray-200 hover:border-indigo-300 hover:text-indigo-600 rounded-md transition-colors"
        >
          <Store className="w-3.5 h-3.5" />
          Marketplace
        </Link>
      </div>

      <div className="flex gap-1 px-6 pt-4 border-b">
        {(
          [
            ["all", "All"],
            ["in-use", "In Use"],
            ["unused", "Unused"],
            ["by-me", "By Me"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-sm rounded-t border-b-2 ${
              tab === id
                ? "border-indigo-600 text-indigo-600 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        <LocalSkillsAutoScan token={token} workspaceId={workspaceId} existingSkills={skills} />
        {isLoading ? (
          <div className="text-gray-400">Loading…</div>
        ) : tab === "in-use" || tab === "unused" ? (
          <div className="text-sm text-gray-400">
            Per-skill binding aggregation is not yet wired up. View the All tab.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p className="text-lg mb-2">{t("noSkillsYet")}</p>
            <p className="text-sm">{t("noSkillsHint")}</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-2xl">
            {filtered.map((s) => (
              <Link
                key={s.id}
                href={`/${workspaceSlug}/skills/${s.id}`}
                className="flex items-center justify-between rounded border p-3 hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium flex items-center gap-1.5">
                    <span className="truncate">{s.name}</span>
                    {(s.config as { sourceTaskId?: string } | null)?.sourceTaskId ? (
                      <span className="text-[11px] text-gray-500">{t("generatedByAgent")}</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                    <VisibilityChip visibility={s.visibility} />
                    {s.description ? <span className="truncate">{s.description}</span> : null}
                  </div>
                </div>
                <div className="text-xs text-gray-500 shrink-0 ml-3">
                  {new Date(s.updatedAt).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

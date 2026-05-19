"use client";
import { BatchActionToolbar } from "@/components/issues/BatchActionToolbar";
import { DependencyGraph } from "@/components/issues/DependencyGraph";
import {
  EMPTY_FILTERS,
  IssueFilterBar,
  type IssueFilters,
  isAnyFilterActive,
} from "@/components/issues/IssueFilterBar";
import { IssueListView } from "@/components/issues/IssueListView";
import { KanbanBoard } from "@/components/issues/KanbanBoard";
import { type IssueView, ViewModeToggle } from "@/components/issues/ViewModeToggle";
import { EmptyState } from "@/components/ui/EmptyState";
import { useIssues } from "@/hooks/useIssues";
import { useWSChannel } from "@/hooks/useWSChannel";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { useUiStore } from "@/lib/ui-store";
import type { IssueDependency, WSMessage } from "@agora/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useState } from "react";

const VALID_VIEWS: ReadonlySet<IssueView> = new Set(["kanban", "list", "my", "graph"]);

function parseView(raw: string | null): IssueView {
  return raw && VALID_VIEWS.has(raw as IssueView) ? (raw as IssueView) : "kanban";
}

type IssueScope = "all" | "member" | "agent";
const VALID_SCOPES: ReadonlySet<IssueScope> = new Set(["all", "member", "agent"]);

function parseScope(raw: string | null): IssueScope {
  return raw && VALID_SCOPES.has(raw as IssueScope) ? (raw as IssueScope) : "all";
}

export default function IssuesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const view = parseView(searchParams.get("view"));
  const scope = parseScope(searchParams.get("scope"));
  const t = useTranslations("issues");

  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<IssueDependency[]>([]);
  const supabase = createClient();
  const qc = useQueryClient();

  // biome-ignore lint/correctness/useExhaustiveDependencies: supabase client is stable singleton
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const t = data.session.access_token;
      setToken(t);
      const [workspaces, me] = await Promise.all([api.listWorkspaces(t), api.getMe(t)]);
      // public.users.id, not supabase auth UUID — see agents/page.tsx.
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
      eventType === "issue.created" ||
      eventType === "issue.updated" ||
      eventType === "issue.deleted"
    ) {
      qc.invalidateQueries({ queryKey: ["issues", workspaceId] });
    }
    if (eventType === "issue.dependencies_changed" && token && workspaceId) {
      api
        .listAllDependencies(token, workspaceId)
        .then((d) => setDependencies(d as IssueDependency[]));
    }
  });

  // Load workspace-wide dependencies whenever we land on (or open) the Graph
  // view. Cheap enough to refetch every time; the WS handler above keeps it
  // fresh while the view is open.
  useEffect(() => {
    if (view !== "graph" || !token || !workspaceId) return;
    api
      .listAllDependencies(token, workspaceId)
      .then((d) => setDependencies(d as IssueDependency[]));
  }, [view, token, workspaceId]);

  // Filter state synced with URL search params so links are shareable.
  const filters = useMemo<IssueFilters>(() => {
    const parseList = (k: string) =>
      searchParams.get(k)?.split(",").filter(Boolean) ?? [];
    return {
      status: parseList("status") as IssueFilters["status"],
      priority: parseList("priority") as IssueFilters["priority"],
      assignee: parseList("assignee"),
      project: parseList("project"),
      labels: parseList("labels"),
    };
  }, [searchParams]);

  const setFilters = useCallback(
    (next: IssueFilters) => {
      const sp = new URLSearchParams(Array.from(searchParams.entries()));
      const apply = (key: keyof IssueFilters) => {
        const v = next[key] as string[];
        if (v.length === 0) sp.delete(key);
        else sp.set(key, v.join(","));
      };
      apply("status");
      apply("priority");
      apply("assignee");
      apply("project");
      apply("labels");
      router.replace(`/${workspaceSlug}/issues?${sp.toString()}`);
    },
    [router, searchParams, workspaceSlug],
  );

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);
  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const { data: rawIssues = [], isLoading } = useIssues(token, workspaceId);
  // "my" view filters client-side to issues the current user owns or created.
  // The scope tabs (全部 / 成员 / 智能体) further narrow by assignee kind.
  // Filter pills (status/priority/assignee/project/labels) further narrow.
  const issues = useMemo(() => {
    let list = rawIssues;
    if (view === "my" && userId) {
      list = list.filter((i) => i.assigneeId === userId || i.creatorId === userId);
    }
    if (scope === "member") {
      list = list.filter((i) => i.assigneeKind === "member");
    } else if (scope === "agent") {
      list = list.filter((i) => i.assigneeKind === "agent");
    }
    if (filters.status.length > 0) {
      list = list.filter((i) => filters.status.includes(i.status));
    }
    if (filters.priority.length > 0) {
      list = list.filter((i) => filters.priority.includes(i.priority));
    }
    if (filters.assignee.length > 0) {
      list = list.filter((i) => {
        if (!i.assigneeId || !i.assigneeKind) return false;
        return filters.assignee.includes(`${i.assigneeKind}:${i.assigneeId}`);
      });
    }
    if (filters.project.length > 0) {
      list = list.filter((i) => i.projectId && filters.project.includes(i.projectId));
    }
    return list;
  }, [rawIssues, view, scope, userId, filters]);

  // Auto-prune selection when filtered out. Return the same array reference
  // when nothing changed so we don't re-render in a tight loop with the
  // useMemo-recomputed `issues` array on every parent render.
  useEffect(() => {
    setSelectedIds((cur) => {
      if (cur.length === 0) return cur;
      const visible = new Set(issues.map((i) => i.id));
      const next = cur.filter((id) => visible.has(id));
      return next.length === cur.length ? cur : next;
    });
  }, [issues]);

  function setView(v: IssueView) {
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    sp.set("view", v);
    router.replace(`/${workspaceSlug}/issues?${sp.toString()}`);
  }

  function setScope(s: IssueScope) {
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    if (s === "all") sp.delete("scope");
    else sp.set("scope", s);
    router.replace(`/${workspaceSlug}/issues?${sp.toString()}`);
  }

  const SCOPE_TABS: { value: IssueScope; labelKey: "scopeAll" | "scopeMember" | "scopeAgent" }[] =
    [
      { value: "all", labelKey: "scopeAll" },
      { value: "member", labelKey: "scopeMember" },
      { value: "agent", labelKey: "scopeAgent" },
    ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-8 py-5 border-b border-gray-200">
        <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">
          {view === "my" ? t("myTitle") : t("title")}
        </h1>
        <div className="flex items-center gap-3">
          <ViewModeToggle view={view} onViewChange={setView} />
        </div>
      </div>

      {view !== "graph" && (
        <div className="px-8 py-2 border-b border-gray-200">
          <IssueFilterBar
            token={token}
            workspaceId={workspaceId}
            filters={filters}
            onChange={setFilters}
          />
        </div>
      )}

      <div className="flex items-center gap-1 px-8 py-2 border-b border-gray-200">
        {SCOPE_TABS.map((tab) => {
          const active = scope === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setScope(tab.value)}
              aria-pressed={active}
              className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs transition-colors ${
                active
                  ? "bg-gray-100 text-gray-900 font-medium"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <EmptyState title="…" />
        ) : issues.length === 0 ? (
          <EmptyState
            title={view === "my" ? t("noneAssigned") : t("noneYet")}
            description={t("startFromChat")}
          />
        ) : view === "kanban" ? (
          <KanbanBoard
            issues={issues}
            workspaceSlug={workspaceSlug}
            token={token}
            workspaceId={workspaceId}
          />
        ) : view === "graph" ? (
          <DependencyGraph
            issues={issues}
            dependencies={dependencies}
            workspaceSlug={workspaceSlug}
          />
        ) : (
          <IssueListView
            issues={issues}
            workspaceSlug={workspaceSlug}
            selectable={view === "list" || view === "my"}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
        )}
      </div>

      {selectedIds.length > 0 && token && workspaceId && (
        <BatchActionToolbar
          selectedIds={selectedIds}
          token={token}
          workspaceId={workspaceId}
          onClear={clearSelection}
        />
      )}
    </div>
  );
}

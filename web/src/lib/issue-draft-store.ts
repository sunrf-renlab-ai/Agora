"use client";
import type { IssuePriority, IssueStatus } from "@agora/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AssigneeKind = "member" | "agent";

export interface IssueDraft {
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeKind: AssigneeKind | null;
  assigneeId: string | null;
  dueDate: string | null;
  projectId: string | null;
  parentIssueId: string | null;
}

const EMPTY: IssueDraft = {
  title: "",
  description: "",
  status: "backlog",
  priority: "none",
  assigneeKind: null,
  assigneeId: null,
  dueDate: null,
  projectId: null,
  parentIssueId: null,
};

interface DraftState {
  draft: IssueDraft;
  setDraft: (patch: Partial<IssueDraft>) => void;
  clearDraft: () => void;
  /** Last-used assignee (kind + id). Persists across sessions so we can
   *  seed a new draft with the same assignee the user picked last time. */
  lastAssigneeKind: AssigneeKind | null;
  lastAssigneeId: string | null;
  setLastAssignee: (kind: AssigneeKind | null, id: string | null) => void;
}

export const useIssueDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      draft: EMPTY,
      setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
      clearDraft: () => set((s) => ({ draft: { ...EMPTY, assigneeKind: s.lastAssigneeKind, assigneeId: s.lastAssigneeId } })),
      lastAssigneeKind: null,
      lastAssigneeId: null,
      setLastAssignee: (kind, id) => set({ lastAssigneeKind: kind, lastAssigneeId: id }),
    }),
    { name: "agora.issue-draft" },
  ),
);

export type CreateMode = "ai" | "manual";

interface CreateModeState {
  lastMode: CreateMode;
  setLastMode: (m: CreateMode) => void;
  keepOpen: boolean;
  setKeepOpen: (v: boolean) => void;
  /** Last picked agent in AI mode — seeds the next open. */
  lastAgentId: string | null;
  setLastAgentId: (id: string | null) => void;
  /** Persisted AI prompt draft so closing/opening doesn't lose typing. */
  prompt: string;
  setPrompt: (p: string) => void;
  clearPrompt: () => void;
}

export const useCreateModeStore = create<CreateModeState>()(
  persist(
    (set) => ({
      lastMode: "ai",
      setLastMode: (m) => set({ lastMode: m }),
      keepOpen: false,
      setKeepOpen: (v) => set({ keepOpen: v }),
      lastAgentId: null,
      setLastAgentId: (id) => set({ lastAgentId: id }),
      prompt: "",
      setPrompt: (p) => set({ prompt: p }),
      clearPrompt: () => set({ prompt: "" }),
    }),
    { name: "agora.create-mode" },
  ),
);

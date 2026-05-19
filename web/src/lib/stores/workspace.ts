import type { Workspace } from "@agora/shared";
import { create } from "zustand";

interface WorkspaceState {
  current: Workspace | null;
  setCurrent: (ws: Workspace | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  current: null,
  setCurrent: (ws) => set({ current: ws }),
}));

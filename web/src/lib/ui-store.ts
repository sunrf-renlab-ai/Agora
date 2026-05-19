"use client";
import { create } from "zustand";

interface UiState {
  shortcutsHelpOpen: boolean;
  setShortcutsHelpOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  shortcutsHelpOpen: false,
  setShortcutsHelpOpen: (v) => set({ shortcutsHelpOpen: v }),
}));

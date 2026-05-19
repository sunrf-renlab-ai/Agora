"use client";
import { useEffect } from "react";

export interface ShortcutMap {
  [keyOrChord: string]: () => void;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (t.isContentEditable) return true;
  return false;
}

const CHORD_TIMEOUT_MS = 1000;

/**
 * Hand-rolled keyboard shortcuts hook.
 *
 * Supports:
 *   - Single keys: `"c": () => ...`
 *   - Chords: `"g i": () => ...` (press g, then i within 1s)
 *
 * Rules:
 *   - Skips when focus is in <input>, <textarea>, <select>, or contenteditable
 *   - Skips when any modifier (meta/ctrl/alt) is held — those are owned by
 *     other handlers like Cmd+K
 *   - If a single-key shortcut and a chord both start with the same key,
 *     the chord wins (we arm chord state and wait for the second key)
 */
export function useShortcuts(map: ShortcutMap): void {
  useEffect(() => {
    let pendingChord: string | null = null;
    let chordTimer: ReturnType<typeof setTimeout> | null = null;

    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();

      if (pendingChord) {
        const chord = `${pendingChord} ${k}`;
        pendingChord = null;
        if (chordTimer) {
          clearTimeout(chordTimer);
          chordTimer = null;
        }
        if (map[chord]) {
          e.preventDefault();
          map[chord]();
        }
        return;
      }

      const chordsStartingWithKey = Object.keys(map).some((kk) => kk.startsWith(`${k} `));

      // Single-key match wins immediately if no chord starts with it.
      if (map[k] && !chordsStartingWithKey) {
        e.preventDefault();
        map[k]();
        return;
      }

      // Otherwise, if any chord starts with this key, arm the chord state.
      if (chordsStartingWithKey) {
        pendingChord = k;
        chordTimer = setTimeout(() => {
          pendingChord = null;
          chordTimer = null;
        }, CHORD_TIMEOUT_MS);
      }
    }

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (chordTimer) clearTimeout(chordTimer);
    };
  }, [map]);
}

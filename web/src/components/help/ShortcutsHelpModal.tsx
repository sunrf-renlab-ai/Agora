"use client";
import { useUiStore } from "@/lib/ui-store";

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: "Navigation",
    items: [
      { keys: ["g", "i"], description: "Go to Inbox" },
      { keys: ["g", "a"], description: "Go to Agents" },
      { keys: ["g", "p"], description: "Go to Projects" },
    ],
  },
  {
    group: "Actions",
    items: [
      { keys: ["c"], description: "Create issue" },
      { keys: ["⌘", "K"], description: "Search issues" },
      { keys: ["?"], description: "Show keyboard shortcuts" },
      { keys: ["Esc"], description: "Close dialog" },
    ],
  },
];

export function ShortcutsHelpModal() {
  const open = useUiStore((s) => s.shortcutsHelpOpen);
  const setOpen = useUiStore((s) => s.setShortcutsHelpOpen);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
      role="presentation"
    >
      <div
        // biome-ignore lint/a11y/useSemanticElements: native <dialog open> uses fixed positioning that conflicts with parent flex centering
        role="dialog"
        className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 border-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-5">
          {SHORTCUTS.map((group) => (
            <section key={group.group}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                {group.group}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((s) => (
                  <li key={s.description} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{s.description}</span>
                    <span className="flex items-center gap-1">
                      {s.keys.map((k, i) => (
                        <span
                          key={`${s.description}-${i}-${k}`}
                          className="flex items-center gap-1"
                        >
                          <kbd className="px-2 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs font-mono text-gray-700 min-w-[1.5rem] text-center">
                            {k}
                          </kbd>
                          {i < s.keys.length - 1 && (
                            <span className="text-gray-300 text-xs">then</span>
                          )}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-5 pt-4 border-t text-xs text-gray-400">
          Press{" "}
          <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded font-mono">
            ?
          </kbd>{" "}
          any time to open this dialog.
        </p>
      </div>
    </div>
  );
}

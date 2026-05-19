"use client";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

export interface MentionItem {
  id: string;
  label: string;
  kind: "member" | "agent" | "issue";
  hint?: string;
}

interface Props {
  items: MentionItem[];
  command: (item: MentionItem) => void;
  /** Optional section header to render at the top of the list. */
  header?: string;
}

export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * Mention dropdown rendered by `@tiptap/suggestion`. The handle exposes
 * `onKeyDown` so the editor's keymap delegates Arrow / Enter / Escape to us.
 */
export const MentionList = forwardRef<MentionListHandle, Props>(function MentionList(
  { items, command, header },
  ref,
) {
  const [active, setActive] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset cursor when items list changes
  useEffect(() => {
    setActive(0);
  }, [items.length]);

  function pick(i: number) {
    const item = items[i];
    if (item) command(item);
  }

  useImperativeHandle(ref, () => ({
    onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowDown") {
        setActive((i) => (i + 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "ArrowUp") {
        setActive((i) => (i - 1 + Math.max(1, items.length)) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        pick(active);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-400 shadow-lg">
        No matches
      </div>
    );
  }

  return (
    <div
      className="max-h-56 w-64 overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
      aria-label="Mention suggestions"
    >
      {header && (
        <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {header}
        </div>
      )}
      {items.map((it, i) => (
        <button
          key={`${it.kind}-${it.id}`}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            pick(i);
          }}
          onMouseEnter={() => setActive(i)}
          aria-selected={i === active}
          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
            i === active ? "bg-indigo-50" : "hover:bg-gray-50"
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-flex size-5 items-center justify-center rounded text-[10px] font-semibold ${
              it.kind === "agent"
                ? "bg-purple-100 text-purple-700"
                : it.kind === "member"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-700"
            }`}
          >
            {it.kind === "agent"
              ? "AI"
              : it.kind === "issue"
                ? "#"
                : (it.label[0]?.toUpperCase() ?? "?")}
          </span>
          <span className="truncate font-medium text-gray-900">{it.label}</span>
          {it.hint && <span className="ml-auto truncate text-gray-400">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
});

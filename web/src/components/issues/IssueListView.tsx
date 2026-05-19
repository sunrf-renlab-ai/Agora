"use client";
import type { Issue } from "@agora/shared";
import { IssueRow } from "./IssueRow";

interface Props {
  issues: Issue[];
  workspaceSlug: string;
  selectable?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
}

/**
 * Vertical list rendering of issues, used by the `list` and `my` views on the
 * issues page. Extracted from `issues/page.tsx` so the page can swap between
 * board / list rendering based on `?view=` without inlining either layout.
 */
export function IssueListView({
  issues,
  workspaceSlug,
  selectable = false,
  selectedIds = [],
  onToggleSelect,
}: Props) {
  return (
    <div>
      {issues.map((issue) => (
        <div key={issue.id} className="relative">
          {selectable && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleSelect?.(issue.id);
              }}
              aria-label={selectedIds.includes(issue.id) ? "Deselect" : "Select"}
              className={`absolute left-2 top-1/2 -translate-y-1/2 z-10 w-4 h-4 rounded border ${
                selectedIds.includes(issue.id)
                  ? "bg-indigo-600 border-indigo-600"
                  : "bg-white border-gray-300 hover:border-gray-400"
              } flex items-center justify-center transition-colors`}
            >
              {selectedIds.includes(issue.id) && (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path d="M2 6.5L5 9L10 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )}
          <div className={selectable ? "pl-8" : undefined}>
            <IssueRow issue={issue} workspaceSlug={workspaceSlug} />
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";
import {
  useAddDependency,
  useIssueDependencies,
  useRemoveDependency,
} from "@/hooks/useDependencies";
import { useIssues } from "@/hooks/useIssues";
import type { IssueDependency } from "@agora/shared";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * Sidebar dependencies panel. Visual goals:
 *   - No screaming sections of "无 / none" — collapses to one quiet line
 *     when there are zero deps in a category
 *   - Inline category labels (kicker on the left, items on the right)
 *     so the panel reads like the rest of the property sidebar
 *   - "Add" affordance is a single + button until clicked, then a tight
 *     inline popover with type + target + confirm — saves vertical
 *     space when the user isn't adding anything
 */
export function DependencyList({
  token,
  workspaceId,
  issueId,
}: {
  token: string;
  workspaceId: string;
  issueId: string;
}) {
  const deps = useIssueDependencies(token, workspaceId, issueId);
  const issues = useIssues(token, workspaceId);
  const add = useAddDependency(token, workspaceId);
  const remove = useRemoveDependency(token, workspaceId);
  const [adding, setAdding] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [type, setType] = useState<"blocks" | "related">("blocks");
  const t = useTranslations("issueDetail.dependencies");

  const data = deps.data ?? { blocks: [], blockedBy: [], related: [] };
  const total = data.blocks.length + data.blockedBy.length + data.related.length;
  const issueLookup = new Map((issues.data ?? []).map((i) => [i.id, i] as const));

  const Chip = ({ d, otherSide }: { d: IssueDependency; otherSide: string }) => {
    const target = issueLookup.get(otherSide);
    return (
      <li className="group flex items-center justify-between gap-2 rounded border border-gray-200 bg-white px-2 py-1 text-[12px] hover:border-gray-300 transition-colors">
        <span className="min-w-0 truncate text-gray-700">
          {target ? (
            <>
              <span className="font-display italic text-gray-400 tabular-nums mr-1.5">
                {target.identifier}
              </span>
              {target.title}
            </>
          ) : (
            otherSide
          )}
        </span>
        <button
          type="button"
          onClick={() => remove.mutate({ issueId, depId: d.id })}
          className="shrink-0 text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Remove dependency"
        >
          <X className="w-3 h-3" />
        </button>
      </li>
    );
  };

  function Section({
    label,
    items,
    otherSideOf,
  }: {
    label: string;
    items: IssueDependency[];
    otherSideOf: (d: IssueDependency) => string;
  }) {
    if (items.length === 0) return null;
    return (
      <div>
        <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-semibold mb-1.5">
          {label}
        </p>
        <ul className="space-y-1">
          {items.map((d) => (
            <Chip key={d.id} d={d} otherSide={otherSideOf(d)} />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {total === 0 && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-900 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("addLink") ?? "Add a dependency"}
        </button>
      )}

      <Section
        label={t("blocks")}
        items={data.blocks}
        otherSideOf={(d) => d.dependsOnIssueId}
      />
      <Section
        label={t("blockedBy")}
        items={data.blockedBy}
        otherSideOf={(d) => d.issueId}
      />
      <Section
        label={t("related")}
        items={data.related}
        otherSideOf={(d) => (d.issueId === issueId ? d.dependsOnIssueId : d.issueId)}
      />

      {total > 0 && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 transition-colors pt-1"
        >
          <Plus className="w-3 h-3" />
          {t("add") ?? "Add"}
        </button>
      )}

      {adding && (
        <div className="border-t border-gray-200 pt-2 space-y-1.5">
          <div className="flex gap-1">
            <label htmlFor="dep-type" className="sr-only">
              Dependency type
            </label>
            <select
              id="dep-type"
              value={type}
              onChange={(e) => setType(e.target.value as "blocks" | "related")}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] focus:outline-none focus:border-indigo-300"
            >
              <option value="blocks">{t("blocks")}</option>
              <option value="related">{t("related")}</option>
            </select>
            <label htmlFor="dep-target" className="sr-only">
              Target issue
            </label>
            <select
              id="dep-target"
              value={selectedTarget}
              onChange={(e) => setSelectedTarget(e.target.value)}
              className="flex-1 min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] focus:outline-none focus:border-indigo-300"
            >
              <option value="">{t("pickIssue")}</option>
              {(issues.data ?? [])
                .filter((i) => i.id !== issueId)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.identifier} — {i.title}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex gap-1.5 justify-end">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setSelectedTarget("");
              }}
              className="px-2 py-1 text-[12px] text-gray-500 hover:text-gray-900 transition-colors"
            >
              {t("cancel") ?? "Cancel"}
            </button>
            <button
              type="button"
              disabled={!selectedTarget}
              onClick={() =>
                add.mutate(
                  { issueId, dependsOnIssueId: selectedTarget, type },
                  {
                    onSuccess: () => {
                      setSelectedTarget("");
                      setAdding(false);
                    },
                  },
                )
              }
              className="px-2.5 py-1 text-[12px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium transition-all active:scale-[0.97] disabled:bg-gray-200 disabled:text-gray-400 disabled:active:scale-100"
            >
              {t("add") ?? "Add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useIssues } from "@/hooks/useIssues";
import { useCreatePin, useDeletePin, usePins } from "@/hooks/usePins";
import { useTranslations } from "next-intl";
import Link from "next/link";

export function PinSidebar({
  token,
  workspaceId,
  workspaceSlug,
}: {
  token: string | null;
  workspaceId: string | null;
  workspaceSlug: string;
}) {
  const pins = usePins(token, workspaceId);
  const issues = useIssues(token, workspaceId);
  const del = useDeletePin(token, workspaceId);
  const t = useTranslations("pins");

  const issueLookup = new Map((issues.data ?? []).map((i) => [i.id, i] as const));

  if (!pins.data || pins.data.length === 0) return null;

  return (
    <section className="px-2 py-2">
      <h3 className="mb-1 px-1 text-xs font-semibold uppercase text-gray-400">{t("heading")}</h3>
      <ul className="space-y-1">
        {pins.data.map((p) => {
          const issue = issueLookup.get(p.itemId);
          const label =
            p.itemType === "issue" ? (issue?.title ?? p.itemId) : `${p.itemType}: ${p.itemId}`;
          const href = p.itemType === "issue" ? `/${workspaceSlug}/issues/${p.itemId}` : "#";
          return (
            <li key={p.id} className="flex items-center justify-between gap-1 px-1 text-xs">
              <Link href={href} className="truncate text-gray-300 hover:text-white">
                {label}
              </Link>
              <button
                type="button"
                onClick={() => del.mutate(p.id)}
                className="opacity-60 hover:opacity-100"
                aria-label={t("unpin")}
                title={t("unpin")}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function PinToggle({
  token,
  workspaceId,
  itemType,
  itemId,
}: {
  token: string | null;
  workspaceId: string | null;
  itemType: "issue" | "project" | "agent";
  itemId: string;
}) {
  const pins = usePins(token, workspaceId);
  const create = useCreatePin(token, workspaceId);
  const del = useDeletePin(token, workspaceId);
  const t = useTranslations("pins");
  const existing = pins.data?.find((p) => p.itemType === itemType && p.itemId === itemId);
  return existing ? (
    <button
      type="button"
      onClick={() => del.mutate(existing.id)}
      className="text-xs text-gray-600 hover:text-gray-800"
    >
      {t("unpin")}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => create.mutate({ itemType, itemId })}
      className="text-xs text-indigo-600 hover:underline"
    >
      {t("pinToSidebar")}
    </button>
  );
}

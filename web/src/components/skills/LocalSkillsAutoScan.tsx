"use client";
import { useToast } from "@/components/ui/Toast";
import {
  useLocalSkillListRequest,
  useRequestLocalSkillImport,
  useRequestLocalSkillList,
} from "@/hooks/useLocalSkills";
import { useRuntimes } from "@/hooks/useRuntimes";
import type { Skill } from "@agora/shared";
import { ArrowUpFromLine, Globe, Loader2, RotateCw, Sparkles, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Props {
  token: string | null;
  workspaceId: string | null;
  /** Skills already imported into this workspace. Used to filter out
   *  local skills that have already been promoted (matching by name). */
  existingSkills: Skill[];
}

type Visibility = "workspace" | "public";

const SCAN_TTL_MS = 5 * 60 * 1000;

/**
 * Auto-scans the user's local agorad daemon for `~/.claude/skills/`
 * entries and surfaces a batch "Promote" flow per skill, with a choice
 * of workspace-shared or fully public scope.
 *
 * Scan results are cached in localStorage per-runtime for 5 minutes so
 * navigating back to the page doesn't fire a fresh daemon round-trip.
 * A manual Rescan button in the header bypasses the cache.
 *
 * Selection model:
 * - Each row has a checkbox; the header has a master select-all.
 * - When anything is selected, a floating action bar pins to the bottom
 *   of the viewport (so it's reachable from a long list), with a
 *   visibility toggle and a single "Promote N" button that fires the
 *   import for each selected skill in parallel.
 * - Per-row Promote button still works for the one-off case.
 *
 * Local skills that are already in this workspace (matched by name)
 * are filtered out so the panel reads as "what's promotable from your
 * machine right now".
 */
export function LocalSkillsAutoScan({ token, workspaceId, existingSkills }: Props) {
  const { toast } = useToast();
  const [scanRequestId, setScanRequestId] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkVisibility, setBulkVisibility] = useState<Visibility>("workspace");

  const { data: runtimes = [] } = useRuntimes(token, workspaceId);
  const onlineRuntime = useMemo(() => runtimes.find((r) => r.online), [runtimes]);
  const runtimeId = onlineRuntime?.id ?? null;

  const requestList = useRequestLocalSkillList(token, workspaceId, runtimeId);
  const requestImport = useRequestLocalSkillImport(token, workspaceId, runtimeId);
  const listResult = useLocalSkillListRequest(token, workspaceId, runtimeId, scanRequestId);

  const cacheKey = runtimeId ? `agora.skill-scan.${runtimeId}` : null;

  const triggerScan = useCallback(
    (opts?: { force?: boolean }) => {
      if (!runtimeId || !cacheKey) return;
      if (!opts?.force) {
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw) {
            const parsed = JSON.parse(raw) as { requestId: string; ts: number };
            if (parsed.requestId && Date.now() - parsed.ts < SCAN_TTL_MS) {
              setScanRequestId(parsed.requestId);
              return;
            }
          }
        } catch {
          // ignore malformed cache
        }
      }
      requestList
        .mutateAsync()
        .then((res) => {
          setScanRequestId(res.requestId);
          try {
            localStorage.setItem(
              cacheKey,
              JSON.stringify({ requestId: res.requestId, ts: Date.now() }),
            );
          } catch {
            // localStorage may be unavailable in private mode — ignore
          }
        })
        .catch(() => {
          /* silent — opportunistic */
        });
    },
    [runtimeId, cacheKey, requestList],
  );

  // Restore cache (or trigger scan) on first runtime sighting.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only on runtimeId change
  useEffect(() => {
    if (!runtimeId || scanRequestId) return;
    triggerScan();
  }, [runtimeId]);

  // Clear selection on Escape — small affordance so the floating bar
  // doesn't feel sticky.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setSelectedKeys(new Set());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const promotedNames = useMemo(() => new Set(existingSkills.map((s) => s.name)), [existingSkills]);

  const localSkills = useMemo(() => {
    const all = listResult.data?.skills ?? [];
    return all.filter((s) => !promotedNames.has(s.name));
  }, [listResult.data, promotedNames]);

  // Prune selection set when local skills disappear (e.g. after promote
  // succeeds + existingSkills refreshes). Avoids a stale checkbox state.
  useEffect(() => {
    const visibleKeys = new Set(localSkills.map((s) => s.key));
    setSelectedKeys((prev) => {
      const next = new Set<string>();
      for (const k of prev) if (visibleKeys.has(k)) next.add(k);
      return next.size === prev.size ? prev : next;
    });
  }, [localSkills]);

  // Hide the section entirely when there's no daemon online + we have
  // nothing useful to say. Otherwise we'd add visual noise to a page
  // the user opened to look at workspace skills.
  if (!onlineRuntime) return null;

  // Pending scan or no local skills found → also hide once it's clear
  // there's nothing to promote, to keep the page calm.
  const scanState = listResult.data?.status;
  if (scanState === "completed" && localSkills.length === 0) return null;

  function toggleSelect(key: string): void {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll(): void {
    setSelectedKeys((prev) => {
      const allSelected = prev.size === localSkills.length;
      return allSelected ? new Set() : new Set(localSkills.map((s) => s.key));
    });
  }

  async function promoteOne(
    s: { key: string; name: string; description: string },
    visibility: Visibility,
  ): Promise<void> {
    setBusyKeys((prev) => new Set(prev).add(s.key));
    try {
      await requestImport.mutateAsync({
        skillKey: s.key,
        name: s.name,
        description: s.description,
        visibility,
      });
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(s.key);
        return next;
      });
    }
  }

  async function promoteBulk(): Promise<void> {
    const targets = localSkills.filter((s) => selectedKeys.has(s.key));
    if (targets.length === 0) return;
    const label = bulkVisibility === "public" ? "publicly" : "to workspace";
    const results = await Promise.allSettled(targets.map((s) => promoteOne(s, bulkVisibility)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - ok;
    if (fail === 0) toast(`Promoted ${ok} skill${ok === 1 ? "" : "s"} ${label}.`, "success");
    else if (ok === 0) toast(`Failed to promote ${fail} skill${fail === 1 ? "" : "s"}.`, "error");
    else toast(`Promoted ${ok} of ${ok + fail}; ${fail} failed.`, "error");
    setSelectedKeys(new Set());
  }

  const allSelected = localSkills.length > 0 && selectedKeys.size === localSkills.length;
  const someSelected = selectedKeys.size > 0;
  const scanPending = scanState === "pending" || !scanRequestId;
  const bulkBusy = busyKeys.size > 0;

  return (
    <section
      className={`mb-6 rounded-md border border-indigo-100 bg-indigo-50/40 p-4 agora-fade-in ${
        someSelected ? "pb-6" : ""
      }`}
    >
      <header className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-indigo-600" />
        <h3 className="text-[13px] font-semibold text-gray-900">
          On your machine{" "}
          <span className="font-display italic text-gray-500 tabular-nums ml-1">
            {scanPending ? "scanning…" : `${localSkills.length} promotable`}
          </span>
        </h3>
        <span className="text-[11px] text-gray-500 ml-auto hidden md:inline">
          Select multiple to promote in batch.
        </span>
        <button
          type="button"
          onClick={() => triggerScan({ force: true })}
          disabled={scanPending || requestList.isPending}
          title="Rescan local skills"
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-600 hover:text-indigo-600 hover:bg-white rounded-sm transition-colors disabled:opacity-50"
        >
          <RotateCw className={`w-3 h-3 ${requestList.isPending ? "animate-spin" : ""}`} />
          Rescan
        </button>
      </header>

      {scanPending ? (
        <div className="flex items-center gap-2 text-[12px] text-gray-500 px-1 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
          Asking your daemon…
        </div>
      ) : (
        <>
          {localSkills.length > 1 && (
            <div className="flex items-center gap-2 mb-2 px-1">
              <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                  aria-label="Select all"
                />
                {allSelected ? "Deselect all" : "Select all"}
              </label>
              {someSelected && (
                <span className="text-[11px] text-gray-500">{selectedKeys.size} selected</span>
              )}
            </div>
          )}

          <ul className="space-y-1.5">
            {localSkills.map((s) => {
              const busy = busyKeys.has(s.key);
              const checked = selectedKeys.has(s.key);
              return (
                <li
                  key={s.key}
                  className={`flex items-center gap-3 rounded border px-3 py-2 transition-colors ${
                    checked ? "bg-indigo-50/80 border-indigo-300" : "bg-white border-gray-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelect(s.key)}
                    disabled={busy}
                    className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer shrink-0"
                    aria-label={`Select ${s.name}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-gray-900 truncate">
                      {s.name}
                    </span>
                    <span className="block text-[11px] text-gray-500 truncate">
                      {s.description || s.sourcePath}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await promoteOne(s, "workspace");
                        toast(`Promoted ${s.name} to workspace.`, "success");
                      } catch (e) {
                        toast(e instanceof Error ? e.message : "Promote failed", "error");
                      }
                    }}
                    title="Share with this workspace"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium transition-all active:scale-[0.97] disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" /> Promoting…
                      </>
                    ) : (
                      <>
                        <ArrowUpFromLine className="w-3 h-3" /> Promote
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {someSelected && (
        <div
          role="region"
          aria-label="Bulk promote actions"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-white rounded-lg border border-gray-200 px-4 py-2.5 shadow-xl agora-fade-in"
        >
          <span className="text-[12px] text-gray-700">
            <span className="font-semibold tabular-nums">{selectedKeys.size}</span> selected —
            promote as
          </span>
          <div
            role="radiogroup"
            aria-label="Visibility scope"
            className="inline-flex rounded-md border border-gray-200 overflow-hidden text-[12px]"
          >
            <button
              type="button"
              role="radio"
              aria-checked={bulkVisibility === "workspace"}
              onClick={() => setBulkVisibility("workspace")}
              title="Anyone in this workspace can install and use it"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                bulkVisibility === "workspace"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Users className="w-3 h-3" />
              <span className="flex flex-col items-start leading-tight">
                <span className="font-medium">Workspace</span>
                <span
                  className={`text-[10px] ${
                    bulkVisibility === "workspace" ? "text-indigo-100" : "text-gray-500"
                  }`}
                >
                  members only
                </span>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={bulkVisibility === "public"}
              onClick={() => setBulkVisibility("public")}
              title="Anyone on Agora can find and install it from the public catalog"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                bulkVisibility === "public"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Globe className="w-3 h-3" />
              <span className="flex flex-col items-start leading-tight">
                <span className="font-medium">Public</span>
                <span
                  className={`text-[10px] ${
                    bulkVisibility === "public" ? "text-indigo-100" : "text-gray-500"
                  }`}
                >
                  anyone on Agora
                </span>
              </span>
            </button>
          </div>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={promoteBulk}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium transition-all active:scale-[0.97] disabled:bg-gray-200 disabled:text-gray-400"
          >
            {bulkBusy ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> Promoting {selectedKeys.size}…
              </>
            ) : (
              <>
                <ArrowUpFromLine className="w-3 h-3" /> Promote {selectedKeys.size}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setSelectedKeys(new Set())}
            title="Clear selection (Esc)"
            aria-label="Clear selection"
            className="text-gray-400 hover:text-gray-700 transition-colors p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </section>
  );
}

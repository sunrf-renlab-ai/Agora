"use client";
import { api } from "@/lib/api";
import { ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface Props {
  token: string | null;
  currentSlug: string;
}

function WorkspaceAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const initial = name?.[0]?.toUpperCase() ?? "?";
  const dim = size === "md" ? "w-6 h-6 text-xs" : "w-5 h-5 text-[10px]";
  // Neutral square avatar. No brand-blue here; the brand
  // colour shows up only on actions (buttons, links), not on the workspace
  // identity chip.
  return (
    <div
      className={`${dim} rounded-md bg-gray-100 text-gray-900 flex items-center justify-center font-semibold shrink-0`}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

export function WorkspaceSwitcher({ token, currentSlug }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const t = useTranslations("sidebar");

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!token) return;
    api.listWorkspaces(token).then((rows) => setWorkspaces(rows as Workspace[]));
  }, [token]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const current = workspaces.find((w) => w.slug === currentSlug);
  const filtered = useMemo(() => {
    if (!query.trim()) return workspaces;
    const q = query.toLowerCase();
    return workspaces.filter(
      (w) => w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q),
    );
  }, [workspaces, query]);
  const showSearch = workspaces.length >= 5;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded hover:bg-gray-300/60 text-gray-900 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <WorkspaceAvatar name={current?.name ?? currentSlug} size="md" />
          <span className="font-semibold truncate">{current?.name ?? currentSlug}</span>
        </div>
        <ChevronsUpDown className="w-4 h-4 text-gray-500 shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-white rounded-md shadow-lg border border-gray-200 z-50 py-1 max-h-72 overflow-hidden flex flex-col">
          {showSearch && (
            <div className="px-2 py-1.5 border-b border-gray-200">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("switchWorkspace")}
                className="w-full bg-gray-50 text-[13px] px-2 py-1 rounded text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-600"
              />
            </div>
          )}
          <div className="overflow-auto flex-1">
            {filtered.map((ws) => (
              <Link
                key={ws.id}
                href={`/${ws.slug}/issues`}
                className={`flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-gray-100 ${
                  ws.slug === currentSlug ? "text-indigo-700 font-medium" : "text-gray-700"
                }`}
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                }}
              >
                <WorkspaceAvatar name={ws.name} />
                <span className="truncate">{ws.name}</span>
              </Link>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">No matches</div>
            )}
          </div>
          <div className="border-t border-gray-200">
            <Link
              href="/workspaces/new"
              className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              onClick={() => {
                setOpen(false);
                setQuery("");
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              {t("createWorkspace")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

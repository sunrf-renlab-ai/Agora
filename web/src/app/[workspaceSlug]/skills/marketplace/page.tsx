"use client";
import { useToast } from "@/components/ui/Toast";
import { ArrowLeft, Download, Globe, Search, Sparkles, User } from "lucide-react";
import Link from "next/link";
import { use, useMemo, useState } from "react";

type Category =
  | "all"
  | "code-review"
  | "testing"
  | "git-workflow"
  | "ops"
  | "writing"
  | "design";

interface PublicSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  category: Exclude<Category, "all">;
  installs: number;
  updatedAt: string;
}

// Placeholder catalog — wired to real data once the public-skills endpoint
// lands. Names mirror skills people actually want their agents to pick up.
const SAMPLE_PUBLIC_SKILLS: PublicSkill[] = [
  {
    id: "review-pr",
    name: "review-pr",
    description:
      "Run a structured PR review: diff sanity, test coverage, SQL safety, and a punch list of nits before approve.",
    author: "agora-core",
    category: "code-review",
    installs: 1284,
    updatedAt: "2026-05-08",
  },
  {
    id: "test-before-push",
    name: "test-before-push",
    description:
      "Pre-push hook that runs the affected test suite and blocks the push if anything fails — saves a CI roundtrip.",
    author: "agora-core",
    category: "testing",
    installs: 982,
    updatedAt: "2026-05-11",
  },
  {
    id: "conventional-commits",
    name: "conventional-commits",
    description:
      "Force commit messages into Conventional Commits format, with scope detection from changed paths.",
    author: "blink",
    category: "git-workflow",
    installs: 743,
    updatedAt: "2026-04-29",
  },
  {
    id: "explain-this-error",
    name: "explain-this-error",
    description:
      "Take a stack trace and resolve it to a likely root cause + 2-3 candidate fixes ranked by risk.",
    author: "agora-core",
    category: "code-review",
    installs: 612,
    updatedAt: "2026-05-13",
  },
  {
    id: "tighten-prose",
    name: "tighten-prose",
    description:
      "Edit any English text to remove filler, replace abstractions with specifics, and cap paragraphs at three sentences.",
    author: "elements-of-style",
    category: "writing",
    installs: 588,
    updatedAt: "2026-05-02",
  },
  {
    id: "design-review",
    name: "design-review",
    description:
      "Audit a UI against your design system: typography, spacing rhythm, color usage, and AI-slop patterns. Cites violations.",
    author: "gstack",
    category: "design",
    installs: 421,
    updatedAt: "2026-05-09",
  },
  {
    id: "render-status",
    name: "render-status",
    description:
      "Query Render Deploy API + Supabase /healthz to summarize current prod health in one line. Pairs with autopilot.",
    author: "blink",
    category: "ops",
    installs: 289,
    updatedAt: "2026-05-06",
  },
  {
    id: "rebase-clean",
    name: "rebase-clean",
    description:
      "Interactive rebase that detects fixup-able commits + reorders by file overlap, never drops a sha.",
    author: "git-tools",
    category: "git-workflow",
    installs: 245,
    updatedAt: "2026-04-22",
  },
  {
    id: "snapshot-diff",
    name: "snapshot-diff",
    description:
      "Run UI screenshot diff against the previous deploy. Surfaces only real visual regressions, not pixel noise.",
    author: "gstack",
    category: "testing",
    installs: 198,
    updatedAt: "2026-05-12",
  },
  {
    id: "release-notes",
    name: "release-notes",
    description:
      "Turn the merged-PR list since last tag into customer-facing release notes — feature, fix, ops sections.",
    author: "agora-core",
    category: "writing",
    installs: 174,
    updatedAt: "2026-05-04",
  },
];

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: "all", label: "All" },
  { id: "code-review", label: "Code review" },
  { id: "testing", label: "Testing" },
  { id: "git-workflow", label: "Git" },
  { id: "ops", label: "Ops" },
  { id: "writing", label: "Writing" },
  { id: "design", label: "Design" },
];

export default function SkillMarketplacePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [installingId, setInstallingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SAMPLE_PUBLIC_SKILLS.filter((s) => {
      if (category !== "all" && s.category !== category) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  function handleInstall(skill: PublicSkill): void {
    setInstallingId(skill.id);
    // Stubbed — real wiring lands once the public catalog endpoint ships.
    window.setTimeout(() => {
      setInstallingId(null);
      toast(`${skill.name} — install lands when the public catalog ships.`, "info");
    }, 400);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/${workspaceSlug}/skills`}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Skills
          </Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-lg font-semibold truncate">Marketplace</h1>
          <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
            <Sparkles className="w-3 h-3" />
            Preview — install ships soon
          </span>
        </div>
      </div>

      <div className="px-6 pt-4 pb-3 border-b space-y-3 bg-gray-50/40">
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search public skills…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:border-indigo-600 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`px-2.5 py-1 text-[12px] rounded-md transition-colors ${
                category === c.id
                  ? "bg-indigo-600 text-white"
                  : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {filtered.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <Globe className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">No public skills match that filter.</p>
          </div>
        ) : (
          <div className="grid gap-3 max-w-4xl md:grid-cols-2">
            {filtered.map((s) => {
              const installing = installingId === s.id;
              return (
                <article
                  key={s.id}
                  className="rounded-md border border-gray-200 bg-white p-4 hover:border-indigo-300 transition-colors"
                >
                  <header className="flex items-start justify-between gap-3 mb-1">
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-semibold text-gray-900 truncate">
                        {s.name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-0.5">
                        <User className="w-3 h-3" />
                        <span className="truncate">{s.author}</span>
                        <span className="text-gray-300">·</span>
                        <span className="tabular-nums">
                          {s.installs.toLocaleString()} installs
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleInstall(s)}
                      disabled={installing}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium transition-all active:scale-[0.97] disabled:bg-gray-200 disabled:text-gray-400 shrink-0"
                    >
                      <Download className="w-3 h-3" />
                      {installing ? "Installing…" : "Install"}
                    </button>
                  </header>
                  <p className="text-[12px] text-gray-600 leading-relaxed">{s.description}</p>
                  <footer className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-gray-200 bg-gray-50 text-[10px] font-medium text-gray-600">
                      {CATEGORIES.find((c) => c.id === s.category)?.label ?? s.category}
                    </span>
                    <span className="text-[10px] text-gray-400 tabular-nums">
                      Updated {s.updatedAt}
                    </span>
                  </footer>
                </article>
              );
            })}
          </div>
        )}

        <p className="text-[11px] text-gray-400 text-center mt-8 max-w-md mx-auto">
          The public catalog is in preview. Listings shown are samples; one-click install
          will be available once the public-skills endpoint lands.
        </p>
      </div>
    </div>
  );
}

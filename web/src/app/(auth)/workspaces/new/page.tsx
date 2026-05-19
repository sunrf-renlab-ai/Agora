"use client";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function NewWorkspacePage() {
  const [displayName, setDisplayName] = useState("");
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  // Slug is derived from the workspace name. We don't show it as a field
  // anymore — the server validates and the user can rename in settings later
  // if there's ever a collision.
  function deriveSlug(n: string) {
    return n
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      // Bound to the schema's 50-char limit. Truncate at a hyphen if possible
      // so the tail doesn't end mid-word, otherwise hard-cut.
      .slice(0, 50)
      .replace(/-+$/, "");
  }

  // Pull current user so we can pre-fill "Your name". On first signup the
  // server seeds `name` to the email — surface a blank field in that case so
  // the user is nudged to enter a real display name.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push("/login");
        return;
      }
      try {
        const me = (await api.getMe(data.session.access_token)) as {
          name: string | null;
          email: string;
        };
        if (cancelled) return;
        setMeEmail(me.email);
        // Treat name === email as "still default" — that's what auth.ts seeds.
        const looksDefault = !me.name || me.name === me.email;
        setDisplayName(looksDefault ? "" : me.name ?? "");
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.push("/login");
      return;
    }
    const token = data.session.access_token;

    try {
      // Save display name first — the workspace's "createdBy" relation will
      // immediately render under this name on the dashboard.
      const trimmedDisplay = displayName.trim();
      if (trimmedDisplay && trimmedDisplay !== meEmail) {
        await api.updateMe(token, { name: trimmedDisplay });
      }
      const ws = (await api.createWorkspace(token, { name, slug: deriveSlug(name) })) as {
        slug: string;
      };
      router.push(`/${ws.slug}/onboarding`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-canvas">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-2 font-semibold">
            Step 1 of 2
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 mb-2">
            Create your workspace
          </h1>
          <p className="text-[14px] text-gray-600 leading-relaxed">
            A workspace is your team's home for issues, agents, and runs.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-md border border-gray-200 p-6 space-y-5"
        >
          <div>
            <label
              htmlFor="display-name"
              className="block text-[12px] font-medium text-gray-700 mb-1.5"
            >
              Your name
            </label>
            <input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={bootstrapping ? "" : "Alex Chen"}
              required
              disabled={bootstrapping}
              maxLength={100}
              className="border border-gray-200 rounded px-3 py-2 text-[13px] w-full focus:border-indigo-600 focus:outline-none transition-colors disabled:bg-gray-50"
            />
            <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
              How you'll appear on issues, comments, and assignments.
            </p>
          </div>

          <div>
            <label htmlFor="ws-name" className="block text-[12px] font-medium text-gray-700 mb-1.5">
              Workspace name
            </label>
            <input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Team"
              required
              className="border border-gray-200 rounded px-3 py-2 text-[13px] w-full focus:border-indigo-600 focus:outline-none transition-colors"
            />
          </div>

          {error && <p className="text-[12px] text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading || bootstrapping}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded px-4 py-2 text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Creating…" : "Continue"}
          </button>
        </form>
        <p className="mt-4 text-center text-[12px] text-gray-500">
          Have an invite?{" "}
          <a href="/workspaces" className="text-indigo-700 hover:underline font-medium">
            See pending invitations
          </a>
        </p>
      </div>
    </div>
  );
}

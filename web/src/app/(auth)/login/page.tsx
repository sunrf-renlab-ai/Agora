"use client";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/**
 * Whitelist of safe `?next=` redirect targets. Anything that isn't a relative
 * path matching one of these prefixes falls back to the default routing — this
 * prevents an attacker from sending `/login?next=https://evil.example/...`
 * and hijacking the post-login redirect into an open-redirect vector.
 */
function safeNextPath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null; // scheme-relative — could escape
  // Allowed prefixes today: /invite/<token>. Add more here as new
  // entry-point flows show up (e.g. /agent-invite/<token>).
  if (/^\/invite\/[A-Za-z0-9_-]+$/.test(raw)) return raw;
  return null;
}

function LoginPageInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const nextPath = safeNextPath(searchParams.get("next"));
  const t = useTranslations("login");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Single-button auth: try sign-in first. If the email isn't registered,
    // sign them up. If the email is registered but the password is wrong,
    // surface that. Either path lands us at a session.
    const signIn = await supabase.auth.signInWithPassword({ email, password });
    let authError = signIn.error;
    if (authError) {
      // Supabase returns "Invalid login credentials" (or i18n variants) for
      // both wrong-password and user-not-found, so we can't distinguish from
      // the message. Try signUp; if the user already exists, the signUp call
      // returns an error and we can show *that* message instead. If signUp
      // succeeds, the credentials we tried just create a fresh account.
      const signUp = await supabase.auth.signUp({ email, password });
      if (signUp.error) {
        // Real error path: email exists but password is wrong, or invalid
        // email format, or the password is too short, etc. Show whichever
        // error is more specific.
        const sameMessage = signUp.error.message === signIn.error?.message;
        authError = sameMessage ? signIn.error : signUp.error;
      } else {
        authError = null;
      }
    }

    if (authError) {
      setLoading(false);
      setError(authError.message);
      return;
    }

    // If the user arrived here via an invite link (or any other safe entry
    // point), honour it AHEAD of the workspace-count fork so brand-new
    // accounts aren't forced through /workspaces/new before they can accept.
    // The invite page itself handles "no workspace yet" by joining the
    // inviter's workspace, so we don't need to pre-create one here.
    if (nextPath) {
      router.push(nextPath);
      setLoading(false);
      return;
    }

    // Route by workspace count + pending invitations so the user lands
    // as deep into the funnel as they need to be. Importantly: when a user
    // has 0 workspaces but a friend has already invited them, we land on
    // /workspaces (which renders the invitation picker) instead of forcing
    // them through /workspaces/new — they don't need to create a junk
    // workspace just to accept an invite later.
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        router.push("/workspaces");
        return;
      }
      const [ws, invs] = await Promise.all([
        api.listWorkspaces(token) as Promise<Array<{ slug: string }>>,
        api.listInvitations(token) as Promise<Array<unknown>>,
      ]);
      if (ws.length === 0) {
        router.push(invs.length > 0 ? "/workspaces" : "/workspaces/new");
      } else if (ws.length === 1 && invs.length === 0) {
        const first = ws[0];
        if (first) router.push(`/${first.slug}/issues`);
        else router.push("/workspaces");
      } else {
        router.push("/workspaces");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    // DESIGN.md says white paper, not bubble-radius SaaS. Pure white canvas;
    // visual hierarchy comes from typography and whitespace, not from a
    // shadowed card. min-h-dvh handles mobile address-bar resize.
    <div className="min-h-dvh flex flex-col items-center justify-center bg-white px-6 py-16">
      <div className="w-full max-w-[380px]">
        {/* Editorial hero — Source Serif 4 italic at display scale gives
            Agora its wordmark presence. Tagline is the product thesis;
            subtitle anchors what tools plug in; the three feature chips
            below stand in for an absent marketing site so a first-time
            visitor can see the shape of the product in <5 seconds. */}
        <header className="text-center mb-10">
          <p className="text-[10.5px] uppercase tracking-[0.22em] text-gray-500 font-semibold mb-3">
            {t("eyebrow")}
          </p>
          <h1 className="font-display italic text-gray-900 leading-none tracking-tight mb-5 text-[64px] sm:text-[72px]">
            Agora
          </h1>
          <p className="text-[15px] sm:text-[16px] text-gray-800 font-medium mb-2 leading-snug max-w-[26ch] mx-auto">
            {t("tagline")}
          </p>
          <p className="text-[12.5px] sm:text-[13px] text-gray-500 leading-relaxed max-w-[42ch] mx-auto mb-5">
            {t("subtitle")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <FeatureChip>{t("featureByoAi")}</FeatureChip>
            <FeatureChip>{t("featureOneBoard")}</FeatureChip>
            <FeatureChip>{t("featureScope")}</FeatureChip>
          </div>
        </header>

        {/* Single hairline separator — magazine-style cue between the
            editorial hero and the utility form. Centered, narrow, 1px. */}
        <div aria-hidden className="h-px bg-gray-200 mx-auto mb-8 max-w-[120px]" />

        {nextPath?.startsWith("/invite/") && (
          <div className="mb-5 rounded-md border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 text-[12px] text-indigo-900 leading-relaxed">
            {t("inviteBanner")}
          </div>
        )}

        <h2 className="sr-only">{t("srHeading")}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Inputs follow DESIGN.md form input recipe, sized up slightly
              for a login-page scale. focus:border-indigo-300 is the
              system's "I'm listening" cue — no chunky 2px focus ring. */}
          <input
            type="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border border-gray-200 rounded-md px-3.5 py-2.5 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-indigo-300 focus:outline-none transition-colors"
          />
          <input
            type="password"
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border border-gray-200 rounded-md px-3.5 py-2.5 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-indigo-300 focus:outline-none transition-colors"
          />
          {error && (
            <p className="text-[12px] text-red-600 leading-snug" role="alert">
              {error}
            </p>
          )}
          {/* Primary button recipe, widened to fill the form column. */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium text-[14px] py-2.5 mt-1 transition-colors disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? t("loading") : t("continue")}
          </button>
          <p className="text-[11px] text-gray-500 text-center mt-3">
            {t("autoCreateHint")}
          </p>
        </form>
      </div>
    </div>
  );
}

// Small, non-interactive label used under the hero to anchor the product's
// three core selling points. Visual treatment is intentionally quiet —
// gray-on-white pill, hairline border — so it reads as supporting copy,
// not as a CTA. DESIGN.md: 'serious utility, ink, decoration is near-zero'.
function FeatureChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center text-[11.5px] text-gray-600 bg-white border border-gray-200 rounded-full px-2.5 py-0.5 leading-snug">
      {children}
    </span>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading…</div>}>
      <LoginPageInner />
    </Suspense>
  );
}

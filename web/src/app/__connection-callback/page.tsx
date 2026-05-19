"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * OAuth callback landing page. The server's
 * `/api/connections/callback` does the actual code-for-token exchange,
 * then 302s the browser here with `?kind=...&status=connected|failed&reason=...`.
 *
 * We don't render anything substantive — we just store a flash message
 * in sessionStorage that the next /knowledge load picks up to toast,
 * then redirect.
 */
export default function ConnectionCallbackPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const kind = params.get("kind") ?? "";
    const status = params.get("status") ?? "";
    const reason = params.get("reason") ?? "";
    try {
      sessionStorage.setItem(
        "agora.connectionFlash",
        JSON.stringify({ kind, status, reason, at: Date.now() }),
      );
    } catch {
      // storage disabled (incognito / strict) — silently skip
    }
    // We don't know the workspace slug from the OAuth callback (Render
    // doesn't carry path state), so route to /workspaces and let the
    // workspace gate pick the right one. The flash + the WS update will
    // surface the result on whichever workspace the user lands on.
    router.replace("/workspaces");
  }, [params, router]);
  return (
    <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">
      Finishing connection…
    </div>
  );
}

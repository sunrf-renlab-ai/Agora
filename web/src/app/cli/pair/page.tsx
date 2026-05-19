"use client";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { Check, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const supabase = createClient();
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Browser approval page for the CLI pairing flow.
 *
 * The CLI hits POST /api/cli/pair/start, prints the code, opens this URL
 * in a browser. Authenticated user clicks Approve. We POST
 * /api/cli/pair/<code>/approve which mints a PAT and stuffs it onto the
 * pair row. The CLI's polling /pair/exchange call picks it up.
 */
function PairInner() {
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const router = useRouter();
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [exists, setExists] = useState<boolean | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [approving, setApproving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace(`/login?redirect=${encodeURIComponent(`/cli/pair?code=${code}`)}`);
        return;
      }
      setToken(data.session.access_token);
    });
  }, [router, code]);

  // Check the code is valid + not already claimed.
  useEffect(() => {
    if (!code) {
      setExists(false);
      return;
    }
    fetch(`${API_URL}/api/cli/pair/${encodeURIComponent(code)}`)
      .then(async (r) => {
        if (!r.ok) {
          setExists(false);
          return;
        }
        const data = (await r.json()) as { claimed: boolean };
        setExists(true);
        setClaimed(data.claimed);
      })
      .catch(() => setExists(false));
  }, [code]);

  async function handleApprove() {
    if (!token || !code || approving) return;
    setApproving(true);
    try {
      const r = await fetch(`${API_URL}/api/cli/pair/${encodeURIComponent(code)}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        toast(body.error ?? `Approval failed (${r.status})`, "error");
        setApproving(false);
        return;
      }
      setDone(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Approval failed", "error");
      setApproving(false);
    }
  }

  if (!code) return <Frame title="Missing pair code">Append `?code=…` to the URL.</Frame>;
  if (exists === null) {
    return (
      <Frame>
        <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
      </Frame>
    );
  }
  if (exists === false) {
    return (
      <Frame title="Code not found">
        That pair code is invalid or expired. Run <code className="font-mono">agorad login</code>{" "}
        again on your machine to get a new one.
      </Frame>
    );
  }
  if (done) {
    return (
      <Frame title="Approved">
        <div className="flex items-center gap-2 text-indigo-700">
          <Check className="w-5 h-5" /> Done. Switch back to your terminal.
        </div>
      </Frame>
    );
  }
  if (claimed) {
    return (
      <Frame title="Already approved">
        This code was already used. If you're seeing this on a fresh login attempt, run{" "}
        <code className="font-mono">agorad login</code> again to get a new code.
      </Frame>
    );
  }
  return (
    <Frame title="Approve CLI device">
      <p className="text-[13px] text-gray-600 mb-4 leading-relaxed">
        A CLI device is asking to pair with your Agora account. Approving issues a device-scoped
        token that the CLI will use to register agents on your behalf.
      </p>
      <div className="bg-gray-100 rounded p-3 mb-5 font-mono text-[13px] text-gray-900 text-center tracking-widest">
        {code}
      </div>
      <button
        type="button"
        onClick={handleApprove}
        disabled={approving || !token}
        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded px-4 py-2 text-[13px] font-medium disabled:opacity-50 transition-colors"
      >
        {approving ? "Approving…" : "Approve"}
      </button>
      <p className="mt-3 text-[11px] text-gray-500">Only approve codes you started yourself.</p>
    </Frame>
  );
}

function Frame({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-canvas">
      <div className="w-full max-w-sm">
        {title && (
          <h1 className="text-[20px] font-semibold tracking-tight text-gray-900 mb-3 text-center">
            {title}
          </h1>
        )}
        <div className="bg-white border border-gray-200 rounded-md p-6">{children}</div>
      </div>
    </div>
  );
}

export default function CliPairPage() {
  return (
    <Suspense fallback={<Frame>Loading…</Frame>}>
      <PairInner />
    </Suspense>
  );
}

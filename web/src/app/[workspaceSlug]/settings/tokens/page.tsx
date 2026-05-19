"use client";
import { useCreatePat, usePats, useRevokePat } from "@/hooks/usePats";
import { createClient } from "@/lib/supabase/client";
import type { PersonalAccessTokenWithCleartext } from "@agora/shared";
import { useEffect, useState } from "react";

const supabase = createClient();

export default function TokensPage() {
  const [token, setToken] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExpires, setNewExpires] = useState("");
  const [created, setCreated] = useState<PersonalAccessTokenWithCleartext | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setToken(data.session.access_token);
    });
  }, []);

  const { data: pats, isLoading } = usePats(token);
  const createMutation = useCreatePat(token);
  const revokeMutation = useRevokePat(token);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    try {
      const expiresAt = newExpires ? new Date(newExpires).toISOString() : null;
      const result = await createMutation.mutateAsync({ name: newName.trim(), expiresAt });
      setCreated(result);
      setNewName("");
      setNewExpires("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create token");
    }
  }

  async function handleRevoke(id: string) {
    if (!token) return;
    if (!confirm("Revoke this token? Anything using it will stop working.")) return;
    await revokeMutation.mutateAsync(id);
  }

  function closeModal() {
    setNewOpen(false);
    setCreated(null);
    setCopied(false);
    setError(null);
    setNewName("");
    setNewExpires("");
  }

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  if (!token) return <div className="p-8 text-gray-400">Not signed in.</div>;

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Personal access tokens</h1>
          <p className="text-sm text-gray-500 mt-1">
            Use these to authenticate with the Agora API or CLI.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="bg-indigo-600 text-white rounded px-4 py-2 text-sm font-medium"
        >
          New token
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-400 text-sm">Loading…</div>
      ) : !pats || pats.length === 0 ? (
        <div className="text-center text-gray-400 py-12 border border-dashed rounded">
          <p className="text-sm">You haven't created any tokens yet.</p>
        </div>
      ) : (
        <ul className="divide-y border rounded">
          {pats.map((p) => (
            <li key={p.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">
                  {p.name}
                  {p.revoked && (
                    <span className="ml-2 text-xs text-red-600 uppercase tracking-wide">
                      Revoked
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 font-mono">{p.tokenPrefix}…</div>
                <div className="text-xs text-gray-400 mt-1">
                  Created {new Date(p.createdAt).toLocaleDateString()}
                  {p.expiresAt && ` · Expires ${new Date(p.expiresAt).toLocaleDateString()}`}
                  {p.lastUsedAt && ` · Last used ${new Date(p.lastUsedAt).toLocaleDateString()}`}
                </div>
              </div>
              {!p.revoked && (
                <button
                  type="button"
                  onClick={() => handleRevoke(p.id)}
                  disabled={revokeMutation.isPending}
                  className="text-sm text-red-600 hover:underline disabled:opacity-50"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {newOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            {created ? (
              <>
                <h2 className="text-lg font-bold mb-2">Token created</h2>
                <p className="text-sm text-gray-600 mb-3">
                  Copy this now. You will not be able to see it again.
                </p>
                <div className="bg-gray-50 border rounded p-3 font-mono text-xs break-all mb-3">
                  {created.token}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(created.token)}
                    className="bg-indigo-600 text-white rounded px-4 py-2 text-sm font-medium"
                  >
                    {copied ? "Copied!" : "Copy token"}
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="border rounded px-4 py-2 text-sm"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleCreate}>
                <h2 className="text-lg font-bold mb-4">New personal access token</h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1" htmlFor="pat-name">
                      Name
                    </label>
                    <input
                      id="pat-name"
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. CLI on laptop"
                      required
                      maxLength={100}
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" htmlFor="pat-expires">
                      Expires (optional)
                    </label>
                    <input
                      id="pat-expires"
                      type="date"
                      value={newExpires}
                      onChange={(e) => setNewExpires(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                {error && <div className="text-sm text-red-600 mt-3">{error}</div>}
                <div className="flex gap-2 mt-5 justify-end">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="border rounded px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="bg-indigo-600 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {createMutation.isPending ? "Creating…" : "Create token"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

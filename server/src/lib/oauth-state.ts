import { createHash, randomBytes } from "node:crypto";
import type { ConnectionKind } from "@agora/shared";

/**
 * In-memory short-lived OAuth state store. Maps the random `state`
 * sent to the provider back to the user + connection kind that
 * initiated the flow, so the callback can:
 *   1. confirm the response is for a flow we started (CSRF)
 *   2. know which user + which kind to write the resulting token to
 *
 * State entries auto-expire after 10 minutes — long enough for the
 * user to authorize, short enough that a stale leaked state is
 * useless. In-memory is fine because Render runs a single instance;
 * if we scale horizontally this moves to Postgres or Redis.
 */
const STATE_TTL_MS = 10 * 60_000;

interface Entry {
  userId: string;
  kind: ConnectionKind;
  expiresAt: number;
}

const store = new Map<string, Entry>();

/** Return a fresh CSRF state and remember which user+kind it belongs to. */
export function issueState(userId: string, kind: ConnectionKind): string {
  // 32 bytes ⇒ 256-bit nonce, encoded url-safe so it survives the
  // provider redirect without any escaping surprises.
  const raw = randomBytes(32).toString("base64url");
  // Hash the stored key so a heap-dump of the server doesn't reveal
  // valid in-flight states. The plaintext only ever leaves the
  // process inside the provider URL.
  const stored = createHash("sha256").update(raw).digest("hex");
  store.set(stored, { userId, kind, expiresAt: Date.now() + STATE_TTL_MS });
  reapExpired();
  return raw;
}

/** Look up + atomically remove a state. Returns null on miss / expired. */
export function consumeState(raw: string): { userId: string; kind: ConnectionKind } | null {
  reapExpired();
  const stored = createHash("sha256").update(raw).digest("hex");
  const entry = store.get(stored);
  if (!entry) return null;
  store.delete(stored);
  if (entry.expiresAt < Date.now()) return null;
  return { userId: entry.userId, kind: entry.kind };
}

function reapExpired(): void {
  const now = Date.now();
  for (const [k, v] of store) if (v.expiresAt < now) store.delete(k);
}

/** Test-only: clear the store. */
export function _resetStateStore(): void {
  store.clear();
}

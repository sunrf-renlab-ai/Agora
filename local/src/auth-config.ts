import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Auth + server URL persisted across runs. Written by the install script
// (server URL only) and `agorad login` (PAT). Read by `agorad daemon start`.

export interface AuthConfig {
  serverUrl: string;
  // PAT (`pat_…`). Optional because the install script writes serverUrl
  // before the user runs `agorad login`.
  token?: string;
}

// Hardcoded fallback Render origin. Used when the cached config points at
// a host that we know proxies through Vercel (which doesn't support WS
// upgrade) — see normalizeServerUrl below for the why.
const DAEMON_FALLBACK_URL = "https://agora-server-ub50.onrender.com";

/**
 * If the cached serverUrl points at a host that fronts Vercel (custom
 * domains, *.vercel.app), the daemon's WS handshake will silently 502
 * because Vercel rewrites only proxy HTTP, not the websocket upgrade.
 * Coerce to the known-good Render origin in that case.
 *
 * Mirrors the server-side guard in cli-dist.ts::resolveDaemonServerUrl —
 * keeping both ends defensive so a stale config from a previous install
 * (or a user who pasted the wrong URL) doesn't strand the daemon.
 */
function normalizeServerUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const isRender =
      u.host.endsWith(".onrender.com") ||
      u.host === "127.0.0.1" ||
      u.host.startsWith("localhost") ||
      u.host.startsWith("127.0.0.1:");
    if (isRender) return raw.replace(/\/+$/, "");
    // Anything else — *.vercel.app, agora.renlab.ai, custom domains —
    // hits the fallback. Logged so it's debuggable.
    console.warn(
      `[agorad] cached serverUrl ${u.host} fronts Vercel (no WS upgrade); ` +
        `falling back to ${DAEMON_FALLBACK_URL}`,
    );
    return DAEMON_FALLBACK_URL;
  } catch {
    return DAEMON_FALLBACK_URL;
  }
}

function authConfigPath(): string {
  return process.env.AGORAD_AUTH_CONFIG ?? join(homedir(), ".agora", "auth.json");
}

function legacyServerPath(): string {
  // The install script writes just the server URL here, before any token
  // exists, so `agorad login` knows where to call.
  return join(homedir(), ".agora", "server.json");
}

export async function loadAuthConfig(): Promise<AuthConfig | null> {
  try {
    const raw = await readFile(authConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as AuthConfig;
    return { ...parsed, serverUrl: normalizeServerUrl(parsed.serverUrl) };
  } catch {
    // Fall back to the install-script-written server.json so `agorad login`
    // works on the very first run.
    try {
      const raw = await readFile(legacyServerPath(), "utf8");
      const parsed = JSON.parse(raw) as { serverUrl?: string };
      if (parsed.serverUrl) {
        return { serverUrl: normalizeServerUrl(parsed.serverUrl) };
      }
    } catch {}
    return null;
  }
}

export async function saveAuthConfig(cfg: AuthConfig): Promise<void> {
  const path = authConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function authConfigPathPublic(): string {
  return authConfigPath();
}

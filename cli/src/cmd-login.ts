import { Command } from "commander";
import { loadAuth, saveAuth } from "./cmd-config";

const DEFAULT_SERVER = process.env.AGORA_SERVER_URL ?? "http://localhost:8080";

type StartResponse = { code: string; browserUrl?: string; expiresAt: string };
type ExchangeResponse = { token: string; userId?: string };
type Me = { id: string; name?: string; email: string };

export const loginCmd = new Command("login")
  .description("Authenticate the Agora CLI (browser pairing or PAT)")
  .option("--token <pat>", "Authenticate using a personal access token instead of pairing")
  .option(
    "--callback-host <host>",
    "Host the browser pairing URL points at (default: localhost)",
    "localhost",
  )
  .option("--server-url <url>", "Override the Agora server URL")
  .action(async (opts: { token?: string; callbackHost: string; serverUrl?: string }) => {
    const existing = await loadAuth();
    const serverUrl = opts.serverUrl ?? existing.serverUrl ?? DEFAULT_SERVER;

    if (opts.token) {
      await loginWithToken(serverUrl, opts.token);
      return;
    }

    await loginByPairing(serverUrl, opts.callbackHost);
  });

async function loginWithToken(serverUrl: string, token: string): Promise<void> {
  const me = await fetchMe(serverUrl, token);
  const existing = await loadAuth();
  await saveAuth({ ...existing, token, serverUrl });
  console.error(`Logged in as ${me.email}`);
}

async function loginByPairing(serverUrl: string, callbackHost: string): Promise<void> {
  const startRes = await fetch(`${serverUrl}/api/cli/pair/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!startRes.ok) {
    throw new Error(`pair start failed: HTTP ${startRes.status}: ${await startRes.text()}`);
  }
  const start = (await startRes.json()) as StartResponse;
  const browserUrl = rewriteCallbackHost(start.browserUrl, callbackHost, start.code, serverUrl);
  console.error(`Open this URL in your browser to approve:\n  ${browserUrl}`);
  await openBrowser(browserUrl);

  const expiresAtMs = Date.parse(start.expiresAt);
  const token = await pollExchange(serverUrl, start.code, expiresAtMs);
  const me = await fetchMe(serverUrl, token);
  const existing = await loadAuth();
  await saveAuth({ ...existing, token, serverUrl });
  console.error(`Logged in as ${me.email}`);
}

// rewriteCallbackHost lets the user override the host in the server-supplied
// browserUrl (typical case: server is bound to 0.0.0.0 but the user's browser
// needs to hit localhost or an FQDN). When the server doesn't return a
// browserUrl, we synthesize one against the configured server URL.
function rewriteCallbackHost(
  browserUrl: string | undefined,
  callbackHost: string,
  code: string,
  serverUrl: string,
): string {
  if (!browserUrl) {
    return `${serverUrl}/cli/pair?code=${encodeURIComponent(code)}`;
  }
  if (!callbackHost || callbackHost === "localhost") return browserUrl;
  try {
    const url = new URL(browserUrl);
    url.hostname = callbackHost;
    return url.toString();
  } catch {
    return browserUrl;
  }
}

async function pollExchange(
  serverUrl: string,
  code: string,
  expiresAtMs: number,
): Promise<string> {
  while (Date.now() < expiresAtMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${serverUrl}/api/cli/pair/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.status === 202) continue;
    if (!res.ok) {
      throw new Error(`pair exchange failed: HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as ExchangeResponse;
    if (body.token) return body.token;
  }
  throw new Error("pairing timed out before approval");
}

async function fetchMe(serverUrl: string, token: string): Promise<Me> {
  const res = await fetch(`${serverUrl}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`/api/me failed: HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as Me;
}

async function openBrowser(url: string): Promise<void> {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Best-effort; we already printed the URL for manual fallback.
  }
}

import { spawn } from "node:child_process";
import { loadAuthConfig, saveAuthConfig } from "./auth-config";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MINUTES = 5;

interface PairStartResponse {
  code: string;
  browserUrl: string;
  expiresAt: string;
}

interface PairExchangeResponse {
  token: string;
  userId: string;
}

export async function runLogin(opts: { serverUrl?: string }): Promise<void> {
  const existing = await loadAuthConfig();
  const serverUrl = opts.serverUrl ?? existing?.serverUrl;
  if (!serverUrl) {
    console.error(
      "[agorad] No server URL configured. Pass --server <url> or run the install script first.",
    );
    process.exit(2);
  }

  const startRes = await fetch(`${serverUrl}/api/cli/pair/start`, { method: "POST" });
  if (!startRes.ok) {
    console.error(`[agorad] Failed to start pairing: ${startRes.status} ${await startRes.text()}`);
    process.exit(1);
  }
  const start = (await startRes.json()) as PairStartResponse;

  console.log("\n  Pair this device by approving the code in your browser:");
  console.log(`\n    ${start.code}\n`);
  console.log(`  Opening: ${start.browserUrl}`);
  console.log(`  (If the browser doesn't open, paste that URL manually.)\n`);
  openInBrowser(start.browserUrl);

  const tokenInfo = await pollForApproval(serverUrl, start.code);
  await saveAuthConfig({ serverUrl, token: tokenInfo.token });
  console.log("[agorad] Logged in. You can now run `agorad daemon start`.");
}

async function pollForApproval(serverUrl: string, code: string): Promise<PairExchangeResponse> {
  const deadline = Date.now() + MAX_POLL_MINUTES * 60_000;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const r = await fetch(`${serverUrl}/api/cli/pair/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (r.status === 200) {
      return (await r.json()) as PairExchangeResponse;
    }
    if (r.status === 202) continue;
    if (r.status === 404) {
      console.error("[agorad] Pair code expired or not found.");
      process.exit(1);
    }
    console.error(`[agorad] Unexpected response: ${r.status} ${await r.text()}`);
    process.exit(1);
  }
  console.error("[agorad] Timed out waiting for browser approval.");
  process.exit(1);
}

function openInBrowser(url: string): void {
  // Best-effort. We don't fail the login if `open` / `xdg-open` is missing —
  // the URL is already printed above for manual paste.
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* swallow — already printed the URL */
    });
    child.unref();
  } catch {
    // ignore
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

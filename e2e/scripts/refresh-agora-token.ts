/**
 * Refresh the qa@agora.test01 Supabase access_token using the stored
 * refresh_token, then rewrite agora-cookies.json + agora-state.json so
 * subsequent playwright runs see a fresh token.
 *
 * Run this whenever tests start failing with 401 / empty data after a day.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const COOKIES_PATH = join(homedir(), ".agora-tools", "agora-cookies.json");
const STATE_PATH = join(__dirname, "..", "fixtures", "agora-state.json");

if (!existsSync(COOKIES_PATH)) {
  console.error(`no cookies file at ${COOKIES_PATH}`);
  process.exit(1);
}

const cookies: Array<Record<string, unknown>> = JSON.parse(readFileSync(COOKIES_PATH, "utf8"));
const sb = cookies.find((c) => c.name === "sb-127-auth-token");
if (!sb) {
  console.error("no sb-127-auth-token cookie");
  process.exit(1);
}
const rawValue = sb.value as string;
const stripped = rawValue.startsWith("base64-") ? rawValue.slice(7) : rawValue;
const session = JSON.parse(Buffer.from(stripped, "base64").toString("utf8"));

console.log("[refresh] current access_token expires_at:", new Date(session.expires_at * 1000));
const refreshToken = session.refresh_token;
if (!refreshToken) {
  console.error("no refresh_token");
  process.exit(1);
}

const res = await fetch(
  `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
  {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  },
);

if (!res.ok) {
  console.error("[refresh] failed:", res.status, await res.text());
  console.error("");
  console.error("If refresh_token is also expired, log in fresh in a Chrome tab,");
  console.error("export the cookies again to", COOKIES_PATH);
  process.exit(1);
}

const fresh = await res.json();
console.log("[refresh] new access_token expires_at:", new Date(fresh.expires_at * 1000));

const newSession = {
  access_token: fresh.access_token,
  token_type: "bearer",
  expires_in: fresh.expires_in,
  expires_at: fresh.expires_at,
  refresh_token: fresh.refresh_token ?? refreshToken,
  user: fresh.user ?? session.user,
};

const newValue = `base64-${Buffer.from(JSON.stringify(newSession)).toString("base64")}`;
sb.value = newValue;
(sb as { expirationDate: number }).expirationDate = fresh.expires_at + 30 * 24 * 3600;
writeFileSync(COOKIES_PATH, `${JSON.stringify(cookies, null, 2)}\n`);
console.log("[refresh] wrote", COOKIES_PATH);

// Rebuild storageState — shared helper strips poisoning cookies and maps
// Chrome's shape to playwright's.
import { chromeToPlaywright, type RawChromeCookie } from "./_cookie-utils";
const playwrightCookies = chromeToPlaywright(cookies as RawChromeCookie[]);
writeFileSync(
  STATE_PATH,
  `${JSON.stringify({ cookies: playwrightCookies, origins: [] }, null, 2)}\n`,
);
console.log("[refresh] wrote", STATE_PATH);

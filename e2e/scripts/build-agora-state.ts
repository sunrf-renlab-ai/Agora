// Build a playwright storageState for localhost agora. Strategy:
// 1. If `~/.agora-tools/agora-cookies.json` exists, convert that chrome
//    cookie export into playwright cookies.
// 2. If `~/.agora-tools/agora-localstorage.json` exists, attach it as an
//    origin's localStorage entry (Supabase stores its session there).
// 3. If neither: write an empty state so tests can still load public pages,
//    and print instructions for the user.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { chromeToPlaywright, type PlaywrightCookie, type RawChromeCookie } from "./_cookie-utils";

const COOKIES_SRC = join(homedir(), ".agora-tools", "agora-cookies.json");
const LS_SRC = join(homedir(), ".agora-tools", "agora-localstorage.json");
const OUT = join(import.meta.dir, "..", "fixtures", "agora-state.json");

let cookies: PlaywrightCookie[] = [];
const origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> = [];

if (existsSync(COOKIES_SRC)) {
  const raw = JSON.parse(readFileSync(COOKIES_SRC, "utf8")) as RawChromeCookie[];
  cookies = chromeToPlaywright(raw);
}

if (existsSync(LS_SRC)) {
  const raw = JSON.parse(readFileSync(LS_SRC, "utf8"));
  // Expected shape: { "http://localhost:3001": { "key1": "val1", ... } }
  for (const [origin, entries] of Object.entries(raw)) {
    if (!entries || typeof entries !== "object") continue;
    origins.push({
      origin,
      localStorage: Object.entries(entries as Record<string, string>).map(([name, value]) => ({
        name,
        value,
      })),
    });
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ cookies, origins }, null, 2));

if (cookies.length === 0 && origins.length === 0) {
  console.warn(
    "⚠ No agora auth fixtures found. Tests on protected routes will hit the login page.\n" +
      `   Drop a Chrome cookie export at ${COOKIES_SRC}\n` +
      `   and/or a localStorage dump at ${LS_SRC}\n` +
      `   Then re-run: bun run e2e/scripts/build-agora-state.ts`,
  );
} else {
  console.log(
    `wrote ${cookies.length} cookies + ${origins.reduce(
      (n, o) => n + o.localStorage.length,
      0,
    )} localStorage entries → ${OUT}`,
  );
}

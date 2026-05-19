// Shared helpers for the two scripts that build playwright storageState
// fixtures (build-agora-state.ts and refresh-agora-token.ts).
//
// The strip list lives here because Chrome cookie exports pull in entries
// that poison subsequent dev-server runs:
//   - __next_hmr_refresh_hash__ — pins the SPA to a single Next.js dev
//     restart; any later restart 404s every static chunk.

export const STRIP_COOKIE_NAMES = new Set([
  "__next_hmr_refresh_hash__",
]);

export interface RawChromeCookie {
  domain: string;
  expirationDate?: number;
  hostOnly?: boolean;
  httpOnly?: boolean;
  name: string;
  path: string;
  sameSite?: string;
  secure?: boolean;
  session?: boolean;
  storeId?: string | null;
  value: string;
}

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export function mapSameSite(s: string | undefined): "Strict" | "Lax" | "None" {
  if (!s) return "Lax";
  const lower = s.toLowerCase();
  if (lower.includes("strict")) return "Strict";
  if (lower.includes("none") || lower === "no_restriction") return "None";
  return "Lax";
}

export function chromeToPlaywright(cookies: RawChromeCookie[]): PlaywrightCookie[] {
  return cookies
    .filter((c) => !STRIP_COOKIE_NAMES.has(c.name))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expirationDate ?? -1,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite: mapSameSite(c.sameSite),
    }));
}

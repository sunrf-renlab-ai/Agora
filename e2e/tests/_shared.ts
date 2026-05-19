import { readFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Shared helpers for playwright specs. Not a test file — the leading
 * underscore + lack of `.spec.ts` suffix keeps it out of playwright's
 * default testMatch glob.
 *
 * The auth proxy here is extracted from feature-walkthrough.spec.ts so
 * multiple specs can reuse it. The walkthrough spec still inlines its
 * own copy (don't want to churn that file just to share code) — keep
 * the two in sync if either changes.
 */
import type { Page, Route } from "@playwright/test";

/**
 * Decode the supabase access_token from the agora storageState fixture so
 * route handlers can attach a fresh Authorization header (the in-browser
 * cookie is opaque to fetch from playwright's perspective).
 */
export function accessToken(): string | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(__dirname, "..", "fixtures", "agora-state.json"), "utf8"),
    );
    const sb = raw.cookies.find((c: { name: string }) => c.name === "sb-127-auth-token");
    if (!sb) return null;
    const v: string = sb.value.startsWith("base64-") ? sb.value.slice(7) : sb.value;
    return JSON.parse(Buffer.from(v, "base64").toString("utf8")).access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Proxy localhost:8080/api/** through node fetch with the supabase token
 * attached. Strips sec-fetch headers and access-control response headers
 * so the page sees a same-origin CORS-clean response.
 *
 * Pass `stripAuth: true` to omit the Authorization header — used by the
 * 401 unauthorized test.
 */
export async function attachApiProxy(
  page: Page,
  opts: { token?: string | null; stripAuth?: boolean } = {},
) {
  const token = opts.token === undefined ? accessToken() : opts.token;
  if (!token && !opts.stripAuth) return;
  await page.context().route("http://localhost:8080/api/**", async (route: Route) => {
    const req = route.request();
    try {
      const baseHeaders = Object.fromEntries(
        Object.entries(req.headers()).filter(([k]) => !k.toLowerCase().startsWith("sec-fetch")),
      );
      const headersOut: Record<string, string> = { ...baseHeaders };
      if (opts.stripAuth) {
        // Make sure no incoming Authorization (or lowercase variant) slips
        // through. Some browsers send both depending on case-handling.
        for (const k of Object.keys(headersOut)) {
          if (k.toLowerCase() === "authorization") delete headersOut[k];
        }
      } else if (token) {
        headersOut.authorization = `Bearer ${token}`;
      }

      const response = await fetch(req.url(), {
        method: req.method(),
        headers: headersOut,
        body:
          req.method() === "GET" || req.method() === "HEAD"
            ? undefined
            : (req.postData() ?? undefined),
        redirect: "manual",
      });
      const body = Buffer.from(await response.arrayBuffer());
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        if (!k.toLowerCase().startsWith("access-control")) headers[k] = v;
      });
      headers["access-control-allow-origin"] = "http://localhost:3002";
      headers["access-control-allow-credentials"] = "true";
      await route.fulfill({ status: response.status, headers, body });
    } catch {
      await route.abort();
    }
  });
}

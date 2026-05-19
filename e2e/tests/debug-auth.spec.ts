import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function accessToken(): string | null {
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
const TOKEN = accessToken();

test("debug auth", async ({ page, context }) => {
  page.on("console", (m) => console.log(`[c.${m.type()}]`, m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("requestfailed", (r) => console.log("[reqfail]", r.url(), r.failure()?.errorText));

  const responses: Array<{ url: string; status: number }> = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/")) responses.push({ url: r.url(), status: r.status() });
  });

  console.log("TOKEN_LENGTH:", TOKEN?.length);

  if (TOKEN) {
    await context.route("http://localhost:8080/api/**", async (route) => {
      const req = route.request();
      const upstream = await fetch(req.url(), {
        method: req.method(),
        headers: {
          ...Object.fromEntries(
            Object.entries(req.headers()).filter(
              ([k]) => !k.toLowerCase().startsWith("sec-fetch"),
            ),
          ),
          authorization: `Bearer ${TOKEN}`,
        },
        body: req.method() === "GET" ? undefined : req.postData() ?? undefined,
        redirect: "manual",
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      const headers: Record<string, string> = {};
      upstream.headers.forEach((v, k) => {
        if (!k.toLowerCase().startsWith("access-control")) headers[k] = v;
      });
      headers["access-control-allow-origin"] = "http://localhost:3002";
      headers["access-control-allow-credentials"] = "true";
      await route.fulfill({ status: upstream.status, headers, body });
    });
  }

  await page.goto("/qa-e2e/issues?e2e=1", { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);

  console.log("\n=== api responses ===");
  for (const r of responses) console.log(`  ${r.status} ${r.url}`);

  const body = await page.locator("body").innerText();
  console.log("\n=== body sample ===\n" + body.slice(0, 300));
  expect(true).toBe(true);
});

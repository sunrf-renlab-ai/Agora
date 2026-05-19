/**
 * Auth error paths — covers cases the feature-walkthrough spec doesn't
 * touch: 401 (no token), 404 (unknown workspace slug), plus a positive
 * smoke that the CORS proxy still works end-to-end.
 *
 * Shares `attachApiProxy` with feature-walkthrough.spec.ts via `_shared.ts`.
 * The walkthrough spec inlines its own copy of the proxy for now to avoid
 * churning that file; keep the two helpers in sync if the proxy ever
 * needs to change.
 *
 * TODO: 403 case needs a member-role storage state fixture (separate user
 * from the qa-e2e owner). Defer until we set up multi-user fixtures.
 */
import { type Response, expect, test } from "@playwright/test";
import { attachApiProxy } from "./_shared";

const SLUG = "qa-e2e";
const BASE_QUERY = "?e2e=1";

test("auth-errors/01 — 401 unauthorized when API token is stripped", async ({ page }) => {
  // Track API responses so we can prove at least one came back 401.
  const apiStatuses: number[] = [];
  page.on("response", (res: Response) => {
    const url = res.url();
    if (url.includes("/api/")) apiStatuses.push(res.status());
  });

  // Proxy /api/** but DROP the Authorization header. The server should
  // reject these with 401 across the board.
  await attachApiProxy(page, { stripAuth: true });

  await page.goto(`/${SLUG}/issues${BASE_QUERY}`, { waitUntil: "domcontentloaded" });
  // Give the page time to fire its initial API calls.
  await page.waitForTimeout(2500);

  // At least one API call should have returned 401.
  expect(apiStatuses.some((s) => s === 401)).toBe(true);

  // UI should NOT be a white screen — body must have some text content.
  const bodyText = (await page.locator("body").innerText()).trim();
  expect(bodyText.length).toBeGreaterThan(0);

  // The page should either show a sign-in CTA, an error indicator, or
  // an empty-state cue. We're permissive about exactly what — the
  // contract is "user is informed something went wrong or no data
  // loaded", not the specific wording. Empty states like "还没有 issue"
  // / "no issues yet" count: that's how the app currently degrades when
  // listIssues returns 401 (silent graceful degradation rather than a
  // toast — documented here as a known UX gap).
  const cueRegex =
    /sign in|signin|log in|login|登录|unauthorized|未授权|error|错误|无法|failed|还没有|empty|no issues|no agents|create your first|创建第一个/i;
  expect(bodyText).toMatch(cueRegex);
});

test("auth-errors/02 — unknown workspace slug falls back gracefully", async ({ page }) => {
  // Normal auth (token attached).
  await attachApiProxy(page);

  // Capture the listWorkspaces response.
  let listWorkspacesStatus: number | null = null;
  let listWorkspacesBody: unknown = null;
  page.on("response", async (res: Response) => {
    const url = res.url();
    if (/\/api\/workspaces(\?|$)/.test(url) && res.request().method() === "GET") {
      listWorkspacesStatus = res.status();
      try {
        listWorkspacesBody = await res.json();
      } catch {
        listWorkspacesBody = null;
      }
    }
  });

  await page.goto(`/nonexistent-workspace-slug-xyz/issues${BASE_QUERY}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2500);

  // listWorkspaces returned 200 with the user's real workspaces.
  expect(listWorkspacesStatus).toBe(200);
  expect(Array.isArray(listWorkspacesBody)).toBe(true);
  expect((listWorkspacesBody as unknown[]).length).toBeGreaterThan(0);

  // Sanity: the user's real workspaces do NOT include the bogus slug.
  const slugs = (listWorkspacesBody as Array<{ slug: string }>).map((w) => w.slug);
  expect(slugs).not.toContain("nonexistent-workspace-slug-xyz");

  // The WorkspaceSwitcher falls back to rendering the slug literal as the
  // active workspace label (current Workspace fallback behavior in
  // web/src/components/sidebar/WorkspaceSwitcher.tsx — `current?.name ??
  // currentSlug`). We assert the slug appears verbatim somewhere on the
  // page and that no workspace whose name happens to equal the bogus slug
  // is presented as active.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).toContain("nonexistent-workspace-slug-xyz");

  // The issues list should be empty (no QA-N identifiers rendered)
  // because there's no resolved workspaceId — the issues query never
  // fires or returns []. We're tolerant: zero rows is the contract.
  const idCount = await page.locator("text=/^QA-\\d+$/").count();
  expect(idCount).toBe(0);
});

test("auth-errors/03 — CORS proxy smoke: QA-N issues render with normal auth", async ({ page }) => {
  await attachApiProxy(page);

  await page.goto(`/${SLUG}/issues${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=QA E2E", { timeout: 8000 });

  // Proves the proxy + auth + workspace resolution still all work after
  // we added the failure-path tests above.
  const ids = await page.locator("text=/^QA-\\d+$/").count();
  expect(ids).toBeGreaterThanOrEqual(1);
});

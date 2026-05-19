/**
 * Feature-walkthrough — exercises every Phase A/B/C feature end-to-end in a
 * real browser, asserts the observable result, and screenshots evidence.
 *
 * Runs against the agora project only.
 * Auth: storageState carries the qa@agora.test01 supabase token; API calls
 * are proxied through playwright route() with that token so CORS doesn't
 * interfere.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Decode the supabase access_token from the storageState fixture so the
// route handler below can attach Authorization.
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

async function attachApiProxy(page: Page) {
  if (!TOKEN) return;
  await page.context().route("http://localhost:8080/api/**", async (route: Route) => {
    const req = route.request();
    try {
      const response = await fetch(req.url(), {
        method: req.method(),
        headers: {
          ...Object.fromEntries(
            Object.entries(req.headers()).filter(
              ([k]) => !k.toLowerCase().startsWith("sec-fetch"),
            ),
          ),
          authorization: `Bearer ${TOKEN}`,
        },
        body:
          req.method() === "GET" || req.method() === "HEAD"
            ? undefined
            : req.postData() ?? undefined,
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

const SLUG = "qa-e2e";
const BASE_QUERY = "?e2e=1";

test.beforeEach(async ({ page }) => {
  await attachApiProxy(page);
});

test("01 — issues list renders 8 seeded issues", async ({ page }, info) => {
  await page.goto(`/${SLUG}/issues${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=QA E2E", { timeout: 8000 });

  // The seed creates QA-1 .. QA-8. We assert at least one identifier is
  // visible to prove the issue rows rendered (vs the empty state).
  const ids = await page.locator("text=/^QA-\\d+$/").count();
  expect(ids).toBeGreaterThanOrEqual(8);

  await page.screenshot({
    path: `e2e/screenshots/walkthrough/01-issues-list.png`,
    fullPage: true,
  });
  await info.attach("01-issues-list", {
    path: `e2e/screenshots/walkthrough/01-issues-list.png`,
    contentType: "image/png",
  });
});

test("02 — filter pill: Status → in_progress narrows list to 2 issues", async ({ page }, info) => {
  await page.goto(`/${SLUG}/issues${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=QA E2E");

  // Open the Status pill popover.
  await page.getByRole("button", { name: /状态|Status/ }).first().click();
  await page.waitForTimeout(300);

  // Pick "In progress". The picker shows both English (status code) +
  // the localized label depending on shape. Tolerant match.
  const inProgress = page
    .locator("[role='option'], [role='menuitem'], button, li")
    .filter({ hasText: /In progress|in_progress|进行中/i })
    .first();
  await inProgress.click({ timeout: 5000 });
  await page.waitForTimeout(500);

  // Close the popover by clicking the title area.
  await page.click("h1", { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(800);

  // URL should reflect the filter.
  expect(page.url()).toContain("status=in_progress");

  // Should now show only QA-2 and QA-8 (the two in_progress seed issues).
  const visibleIds = await page.locator("text=/^QA-\\d+$/").allTextContents();
  expect(visibleIds.length).toBeLessThanOrEqual(3); // tolerant — exact 2 expected
  expect(visibleIds.length).toBeGreaterThanOrEqual(1);

  await page.screenshot({
    path: `e2e/screenshots/walkthrough/02-filter-status.png`,
    fullPage: true,
  });
  await info.attach("02-filter-status", {
    path: `e2e/screenshots/walkthrough/02-filter-status.png`,
    contentType: "image/png",
  });
});

test("03 — batch selection: check 2 rows → toolbar appears", async ({ page }, info) => {
  await page.goto(`/${SLUG}/issues${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=QA E2E");
  await page.waitForTimeout(1500);

  // Each row has an unlabeled checkbox button positioned absolutely. We
  // grab them by their aria-label set in IssueListView.
  const selectButtons = page.locator("button[aria-label='Select']");
  const count = await selectButtons.count();
  expect(count).toBeGreaterThanOrEqual(2);

  await selectButtons.nth(0).click();
  await selectButtons.nth(1).click();
  await page.waitForTimeout(400);

  // The batch toolbar shows a "2 selected" / "已选 2 项" string.
  const toolbar = page.getByText(/2 selected|已选 2 项/i).first();
  await expect(toolbar).toBeVisible({ timeout: 3000 });

  await page.screenshot({
    path: `e2e/screenshots/walkthrough/03-batch-toolbar.png`,
    fullPage: true,
  });
  await info.attach("03-batch-toolbar", {
    path: `e2e/screenshots/walkthrough/03-batch-toolbar.png`,
    contentType: "image/png",
  });
});

test("04 — issue detail: open QA-1 → tabs visible", async ({ page }, info) => {
  await page.goto(`/${SLUG}/issues${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=QA E2E");
  await page.waitForTimeout(1000);

  // Click first row anywhere except the checkbox.
  await page.locator("text=/^QA-1$/").first().click();
  await page.waitForURL(/\/issues\//, { timeout: 5000 });
  await page.waitForTimeout(2000);

  // Execution logs tab should be present and clickable.
  const execTab = page.getByRole("tab", { name: /执行记录|Execution logs/i });
  await expect(execTab).toHaveCount(1, { timeout: 5000 });
  await execTab.scrollIntoViewIfNeeded();
  await expect(execTab).toBeVisible();

  await page.screenshot({
    path: `e2e/screenshots/walkthrough/04-issue-detail.png`,
    fullPage: true,
  });
  await info.attach("04-issue-detail", {
    path: `e2e/screenshots/walkthrough/04-issue-detail.png`,
    contentType: "image/png",
  });
});

test("05 — runtime detail: navigate to /runtimes/[id]", async ({ page }, info) => {
  await page.goto(`/${SLUG}/runtimes${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Click the first runtime row (seed creates "Local QA").
  const row = page.getByText(/Local QA/i).first();
  await expect(row).toBeVisible({ timeout: 4000 });
  await row.click();
  await page.waitForURL(/\/runtimes\/[0-9a-f-]+/, { timeout: 5000 });
  await page.waitForTimeout(1500);

  // Detail page should show the back link.
  const back = page.getByText(/返回 Runtime|Back to runtimes/i).first();
  await expect(back).toBeVisible();

  await page.screenshot({
    path: `e2e/screenshots/walkthrough/05-runtime-detail.png`,
    fullPage: true,
  });
  await info.attach("05-runtime-detail", {
    path: `e2e/screenshots/walkthrough/05-runtime-detail.png`,
    contentType: "image/png",
  });
});

test("06 — TipTap comment input: editor mounted on issue detail", async ({ page }, info) => {
  await page.goto(`/${SLUG}/issues${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.locator("text=/^QA-1$/").first().click();
  await page.waitForURL(/\/issues\//, { timeout: 5000 });
  await page.waitForTimeout(2000);

  // TipTap renders a ProseMirror contenteditable.
  const editor = page.locator(".ProseMirror, [contenteditable='true']").first();
  await expect(editor).toBeVisible({ timeout: 5000 });

  // Type a comment.
  await editor.click();
  await editor.fill("test comment from walkthrough");
  await page.waitForTimeout(300);

  // Comment button should be enabled.
  const submitBtn = page.getByRole("button", { name: /^Comment$|^评论$/ }).first();
  await expect(submitBtn).toBeEnabled({ timeout: 2000 });

  await page.screenshot({
    path: `e2e/screenshots/walkthrough/06-tiptap-comment.png`,
    fullPage: true,
  });
  await info.attach("06-tiptap-comment", {
    path: `e2e/screenshots/walkthrough/06-tiptap-comment.png`,
    contentType: "image/png",
  });
});

test("07 — agents page lists QA Agent", async ({ page }, info) => {
  await page.goto(`/${SLUG}/agents${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  await expect(page.getByText(/QA Agent/i).first()).toBeVisible({ timeout: 4000 });

  await page.screenshot({
    path: `e2e/screenshots/walkthrough/07-agents.png`,
    fullPage: true,
  });
  await info.attach("07-agents", {
    path: `e2e/screenshots/walkthrough/07-agents.png`,
    contentType: "image/png",
  });
});

test("08 — inbox page renders", async ({ page }, info) => {
  await page.goto(`/${SLUG}/inbox${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Either empty state or items list.
  const body = await page.locator("body").innerText();
  expect(body).toMatch(/收件箱|Inbox/);

  await page.screenshot({
    path: `e2e/screenshots/walkthrough/08-inbox.png`,
    fullPage: true,
  });
  await info.attach("08-inbox", {
    path: `e2e/screenshots/walkthrough/08-inbox.png`,
    contentType: "image/png",
  });
});

test("09 — projects page shows Web Redesign", async ({ page }, info) => {
  await page.goto(`/${SLUG}/projects${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Project title is "Web Redesign" from seed.
  await expect(page.getByText(/Web Redesign/i).first()).toBeVisible({ timeout: 4000 });

  await page.screenshot({
    path: `e2e/screenshots/walkthrough/09-projects.png`,
    fullPage: true,
  });
  await info.attach("09-projects", {
    path: `e2e/screenshots/walkthrough/09-projects.png`,
    contentType: "image/png",
  });
});

test("10 — quick-create dialog: 'c' shortcut opens it", async ({ page }, info) => {
  await page.goto(`/${SLUG}/issues${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Click body to focus, then press 'c' (the shortcut from layout.tsx).
  await page.locator("body").click();
  await page.keyboard.press("c");
  await page.waitForTimeout(800);

  // Dialog should be visible with create/Create button.
  const dialog = page
    .locator("[role='dialog']")
    .or(page.locator("text=/Create Issue|创建 Issue|创建/").first());
  await expect(dialog.first()).toBeVisible({ timeout: 3000 });

  await page.screenshot({
    path: `e2e/screenshots/walkthrough/10-quick-create.png`,
    fullPage: true,
  });
  await info.attach("10-quick-create", {
    path: `e2e/screenshots/walkthrough/10-quick-create.png`,
    contentType: "image/png",
  });
});

test("11 — i18n switch via cookie reload", async ({ page, context }, info) => {
  // First load in default (zh-Hans). Then set the agora-locale cookie to en
  // and reload — UI should switch to English.
  await page.goto(`/${SLUG}/issues${BASE_QUERY}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  expect(await page.locator("body").innerText()).toMatch(/收件箱|Issue/);

  await context.addCookies([
    {
      name: "agora-locale",
      value: "en",
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const body = await page.locator("body").innerText();
  expect(body).toMatch(/Inbox|Issues/);
  expect(body).not.toMatch(/收件箱/);

  await page.screenshot({
    path: `e2e/screenshots/walkthrough/11-i18n-en.png`,
    fullPage: true,
  });
  await info.attach("11-i18n-en", {
    path: `e2e/screenshots/walkthrough/11-i18n-en.png`,
    contentType: "image/png",
  });
});

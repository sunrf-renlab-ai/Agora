// Verifies the open-redirect whitelist on `?next=`. The full Suspense /
// router-driven flow is exercised manually; this test pins the URL parser.

import { describe, expect, it } from "bun:test";

// Re-implement the whitelist here so we can assert without booting the
// component. Keep this in sync with login/page.tsx::safeNextPath.
function safeNextPath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (/^\/invite\/[A-Za-z0-9_-]+$/.test(raw)) return raw;
  return null;
}

describe("safeNextPath", () => {
  it("accepts /invite/<token>", () => {
    expect(safeNextPath("/invite/abc123_-XYZ")).toBe("/invite/abc123_-XYZ");
  });
  it("rejects external URLs", () => {
    expect(safeNextPath("https://evil.example/x")).toBeNull();
    expect(safeNextPath("//evil.example/x")).toBeNull();
  });
  it("rejects unknown internal paths", () => {
    expect(safeNextPath("/issues")).toBeNull();
    expect(safeNextPath("/workspaces/new")).toBeNull();
  });
  it("rejects malformed invite tokens", () => {
    expect(safeNextPath("/invite/")).toBeNull();
    expect(safeNextPath("/invite/with spaces")).toBeNull();
    expect(safeNextPath("/invite/abc?injected=true")).toBeNull();
  });
  it("returns null on null/empty", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });
});

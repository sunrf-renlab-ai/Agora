// Regression test for the Hono sub-app middleware-leakage trap.
// See the comment block in src/routes/index.ts for the full invariant.
//
// Empirical bugs this catches:
//   1. /api/invitations 400'd by membersRouter's workspaceMiddleware
//      (no X-Workspace-ID header) until invitationsRouter was hoisted
//      above the workspace-scoped band.
//   2. /api/connections/callback was 401'd by a later router's
//      authMiddleware before connectionsRouter moved to slot #3.
//
// We assert against the full createApp() — per-router unit tests
// (e.g. invitations.test.ts) test the route in isolation and would
// not catch a sibling middleware hijack.
import { describe, expect, it } from "bun:test";
import { createApp } from "./index";

describe("routes/index mount order — non-workspace routes not hijacked", () => {
  const app = createApp();

  // Without auth header, every authMiddleware-guarded route should
  // surface 401 "Missing authorization token". If it surfaces 400
  // ("X-Workspace-ID header required"), a sibling's workspaceMiddleware
  // leaked in and consumed the request before our route's middleware ran.
  const userScopedPaths = [
    "/api/invitations",
    "/api/me/tokens",
    "/api/me/feedback",
    "/api/me/notification-preferences",
  ];

  for (const path of userScopedPaths) {
    it(`GET ${path} returns 401 (not 400) when unauthenticated`, async () => {
      const res = await app.request(path);
      expect(res.status).toBe(401);
    });
  }

  // CLI installers are invoked via `curl | bash` and `iwr | iex` BEFORE
  // the user has any credentials on their machine, so they must serve
  // their script body unauthenticated. NO_AUTH_PATHS in auth.ts must
  // cover both. Windows users hit a real 401 once because install.ps1
  // was missing from the bypass regex while install.sh was in it.
  const publicInstallerPaths = ["/api/cli/install.sh", "/api/cli/install.ps1"];
  for (const path of publicInstallerPaths) {
    it(`GET ${path} returns 200 (not 401) when unauthenticated`, async () => {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      const body = await res.text();
      // Confirm we actually got the installer text, not an error body that
      // happens to be 200.
      expect(body.length).toBeGreaterThan(100);
    });
  }
});

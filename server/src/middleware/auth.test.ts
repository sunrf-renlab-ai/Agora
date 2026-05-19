import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { requireUser } from "./auth";

describe("requireUser middleware", () => {
  it("rejects agent-token requests to owner-scoped paths (e.g. /api/me)", async () => {
    const app = new Hono();
    app.use((c, next) => {
      c.set("taskAuth", { taskId: "t1", agentId: "a1", workspaceId: "w1" });
      return next();
    });
    app.use(requireUser);
    app.get("/api/me", (c) => c.json({ ok: true }));

    const res = await app.request("/api/me");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Agent tokens cannot access owner-scoped");
  });

  it("passes through real-user requests on owner-scoped paths", async () => {
    const app = new Hono();
    app.use(requireUser);
    app.get("/api/me", (c) => c.json({ ok: true }));

    const res = await app.request("/api/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  // Regression: middleware MUST NOT block agent-token traffic on
  // workspace-scoped routes just because requireUser was reachable from
  // a sibling sub-app. This is the exact failure that took down chat
  // quick-create when /api/me's app.use(requireUser) leaked across
  // every sub-app mounted at "/" — every `agora issue create` from a
  // chat-spawned agent came back with HTTP 403.
  it("does NOT touch agent-token requests on non-owner-scoped paths", async () => {
    const app = new Hono();
    app.use((c, next) => {
      c.set("taskAuth", { taskId: "t1", agentId: "a1", workspaceId: "w1" });
      return next();
    });
    app.use(requireUser);
    app.post("/api/workspaces/wsid/issues", (c) => c.json({ ok: true }, 201));

    const res = await app.request("/api/workspaces/wsid/issues", { method: "POST" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  // Same regression for /api/workspaces/:wsid/agents (agora agent list)
  // and /api/workspaces/:wsid/comments (agora issue comment add) — the
  // two other paths chat-spawned agents hit constantly.
  it("does NOT touch agent-token requests on agents / comments routes", async () => {
    const app = new Hono();
    app.use((c, next) => {
      c.set("taskAuth", { taskId: "t1", agentId: "a1", workspaceId: "w1" });
      return next();
    });
    app.use(requireUser);
    app.get("/api/workspaces/wsid/agents", (c) => c.json([]));
    app.post("/api/workspaces/wsid/issues/iid/comments", (c) => c.json({ ok: true }));

    const r1 = await app.request("/api/workspaces/wsid/agents");
    expect(r1.status).toBe(200);
    const r2 = await app.request("/api/workspaces/wsid/issues/iid/comments", {
      method: "POST",
    });
    expect(r2.status).toBe(200);
  });
});

import { describe, expect, it } from "bun:test";
import patsRouter from "./pats";

describe("pats routes", () => {
  it("requires auth on list", async () => {
    const res = await patsRouter.request("/api/me/tokens");
    expect(res.status).toBe(401);
  });

  it("requires auth on create", async () => {
    const res = await patsRouter.request("/api/me/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("requires auth on revoke", async () => {
    const res = await patsRouter.request(
      "/api/me/tokens/00000000-0000-0000-0000-000000000000/revoke",
      { method: "POST" },
    );
    expect(res.status).toBe(401);
  });
});

import { describe, expect, it } from "bun:test";
import agentsRouter from "./agents";

describe("agents route", () => {
  it("returns 401 without auth", async () => {
    const res = await agentsRouter.request(
      "/api/workspaces/00000000-0000-0000-0000-000000000000/agents",
    );
    expect(res.status).toBe(401);
  });
});

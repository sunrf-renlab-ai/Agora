import { describe, expect, it } from "bun:test";
import feedbackRouter from "./feedback";

describe("feedback routes", () => {
  it("requires auth on list", async () => {
    const res = await feedbackRouter.request("/api/me/feedback");
    expect(res.status).toBe(401);
  });

  it("requires auth on submit", async () => {
    const res = await feedbackRouter.request("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(res.status).toBe(401);
  });
});

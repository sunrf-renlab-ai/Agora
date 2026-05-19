import { describe, expect, it } from "bun:test";
import notificationPreferencesRouter from "./notification-preferences";

describe("notification preferences routes", () => {
  it("requires auth on GET", async () => {
    const res = await notificationPreferencesRouter.request("/api/me/notification-preferences");
    expect(res.status).toBe(401);
  });

  it("requires auth on PATCH", async () => {
    const res = await notificationPreferencesRouter.request("/api/me/notification-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignments: { enabled: false } }),
    });
    expect(res.status).toBe(401);
  });
});

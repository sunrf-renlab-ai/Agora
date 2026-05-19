import { describe, expect, test } from "bun:test";
import { createApp } from "./index";

describe("GET /healthz", () => {
  test("returns 200 ok", async () => {
    const app = createApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

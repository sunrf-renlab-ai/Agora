import { describe, expect, test } from "bun:test";
import metricsRouter from "./metrics";

describe("GET /metrics", () => {
  test("returns 200 with tasks24h and runtimes keys", async () => {
    const res = await metricsRouter.request("/metrics");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ts: string;
      tasks24h: Record<string, number>;
      runtimes: Record<string, number>;
    };
    expect(typeof body.ts).toBe("string");
    expect(body).toHaveProperty("tasks24h");
    expect(body).toHaveProperty("runtimes");
    expect(typeof body.tasks24h).toBe("object");
    expect(typeof body.runtimes).toBe("object");
  });
});

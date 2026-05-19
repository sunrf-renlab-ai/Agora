import { describe, expect, it } from "bun:test";
import { computeNextRun, validateTimezone } from "./cron";

describe("computeNextRun", () => {
  it("returns a future date in the given timezone", () => {
    const t = computeNextRun("0 * * * *", "UTC"); // top of every hour
    expect(t.getTime()).toBeGreaterThan(Date.now());
    expect(t.getMinutes()).toBe(0);
  });

  it("throws on invalid cron expression", () => {
    expect(() => computeNextRun("not-a-cron", "UTC")).toThrow();
  });

  it("throws on invalid timezone", () => {
    expect(() => computeNextRun("0 * * * *", "Mars/Olympus")).toThrow();
  });
});

describe("validateTimezone", () => {
  it("accepts UTC", () => {
    expect(() => validateTimezone("UTC")).not.toThrow();
  });
  it("accepts named TZs", () => {
    expect(() => validateTimezone("America/New_York")).not.toThrow();
  });
  it("rejects garbage", () => {
    expect(() => validateTimezone("Foo/Bar")).toThrow();
  });
});

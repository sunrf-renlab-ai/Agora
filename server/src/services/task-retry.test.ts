import { describe, expect, it } from "bun:test";
import { backoffDelayMs, decideRetry } from "./task-retry";

describe("backoffDelayMs", () => {
  it("returns 10s for attempt=1", () => {
    expect(backoffDelayMs(1)).toBe(10_000);
  });
  it("doubles each attempt", () => {
    expect(backoffDelayMs(2)).toBe(20_000);
    expect(backoffDelayMs(3)).toBe(40_000);
    expect(backoffDelayMs(4)).toBe(80_000);
    expect(backoffDelayMs(5)).toBe(160_000);
  });
  it("caps at 5 minutes", () => {
    expect(backoffDelayMs(20)).toBe(300_000);
  });
  it("returns 0 for attempt < 1", () => {
    expect(backoffDelayMs(0)).toBe(0);
  });
});

describe("decideRetry", () => {
  it("retries transient failures with backoff", () => {
    const d = decideRetry({ attempt: 1, maxAttempts: 3, errorKind: "turn_timeout" });
    expect(d.kind).toBe("retry");
    if (d.kind === "retry") {
      expect(d.nextAttempt).toBe(2);
      expect(d.delayMs).toBe(10_000);
    }
  });

  it("does not retry deterministic failures", () => {
    const d = decideRetry({ attempt: 1, maxAttempts: 3, errorKind: "prompt_render_error" });
    expect(d.kind).toBe("skip");
    if (d.kind === "skip") expect(d.reason).toBe("non_retryable_error_kind");
  });

  it("does not retry when missing errorKind", () => {
    const d = decideRetry({ attempt: 1, maxAttempts: 3, errorKind: null });
    expect(d.kind).toBe("skip");
  });

  it("does not retry past maxAttempts", () => {
    const d = decideRetry({ attempt: 3, maxAttempts: 3, errorKind: "turn_timeout" });
    expect(d.kind).toBe("skip");
    if (d.kind === "skip") expect(d.reason).toBe("max_attempts_reached");
  });

  it("uses 1s flat delay for continuation retries", () => {
    const d = decideRetry({ attempt: 1, maxAttempts: 3, errorKind: null, continuation: true });
    expect(d.kind).toBe("retry");
    if (d.kind === "retry") expect(d.delayMs).toBe(1_000);
  });

  it("continuation retry respects max attempts", () => {
    const d = decideRetry({ attempt: 5, maxAttempts: 5, errorKind: null, continuation: true });
    expect(d.kind).toBe("skip");
  });

  it("retryable kinds: turn_timeout, stall_timeout, agent_crashed, agent_spawn_failed, tracker_error", () => {
    for (const k of [
      "turn_timeout",
      "stall_timeout",
      "agent_crashed",
      "agent_spawn_failed",
      "tracker_error",
    ]) {
      expect(decideRetry({ attempt: 1, maxAttempts: 2, errorKind: k }).kind).toBe("retry");
    }
  });
});

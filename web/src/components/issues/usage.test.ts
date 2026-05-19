import { describe, expect, it } from "bun:test";
import { aggregateUsage } from "./usage";
import type { AgentTask } from "@agora/shared";

function t(usage: Record<string, unknown> | null): AgentTask {
  return { usage, status: "completed" } as unknown as AgentTask;
}

describe("aggregateUsage", () => {
  it("returns zeros for empty input", () => {
    expect(aggregateUsage([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      runs: 0,
    });
  });

  it("sums input / output / cache and counts runs", () => {
    const tasks = [
      t({ inputTokens: 100, outputTokens: 50, cacheTokens: 10 }),
      t({ inputTokens: 200, outputTokens: 80, cacheTokens: 0 }),
      t(null),
    ];
    expect(aggregateUsage(tasks)).toEqual({
      inputTokens: 300,
      outputTokens: 130,
      cacheTokens: 10,
      runs: 3,
    });
  });

  it("tolerates partial usage objects", () => {
    const tasks = [t({ inputTokens: 7 }), t({ outputTokens: 3 })];
    expect(aggregateUsage(tasks)).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      cacheTokens: 0,
      runs: 2,
    });
  });
});

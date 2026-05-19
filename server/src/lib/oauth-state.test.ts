import { afterEach, describe, expect, it } from "bun:test";
import { _resetStateStore, consumeState, issueState } from "./oauth-state";

describe("oauth-state", () => {
  afterEach(() => _resetStateStore());

  it("issued state is consumable exactly once", () => {
    const s = issueState("user-1", "linear");
    const first = consumeState(s);
    expect(first).toEqual({ userId: "user-1", kind: "linear" });
    const second = consumeState(s);
    expect(second).toBeNull();
  });

  it("unknown state returns null (CSRF check fails closed)", () => {
    expect(consumeState("does-not-exist")).toBeNull();
  });

  it("two issued states for the same user are independent", () => {
    const a = issueState("u", "linear");
    const b = issueState("u", "github");
    expect(consumeState(a)?.kind).toBe("linear");
    expect(consumeState(b)?.kind).toBe("github");
  });

  it("issued state is high-entropy (32-byte base64url, no padding)", () => {
    const s = issueState("u", "linear");
    // 32 bytes base64url = ceil(32*4/3) = 43 chars, no padding
    expect(s.length).toBeGreaterThanOrEqual(40);
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s).not.toContain("=");
    expect(s).not.toContain("+");
    expect(s).not.toContain("/");
  });
});

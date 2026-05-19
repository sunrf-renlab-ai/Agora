import { describe, expect, it } from "bun:test";
import { generatePat, hashPat } from "./pat-token";

describe("personal access tokens", () => {
  it("generates a prefixed token, an 8-char display prefix, and stable sha256 hash", () => {
    const { token, hash, prefix } = generatePat();
    expect(token.startsWith("pat_")).toBe(true);
    expect(token.length).toBeGreaterThan(20);
    expect(prefix).toBe(token.slice(0, 8));
    expect(prefix.length).toBe(8);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPat(token)).toBe(hash);
  });

  it("different tokens hash differently", () => {
    const a = generatePat();
    const b = generatePat();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });
});

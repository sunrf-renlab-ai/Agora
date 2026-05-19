import { describe, expect, it } from "bun:test";
import { generateWebhookToken, hashWebhookToken } from "./webhook-token";

describe("webhook tokens", () => {
  it("generates a prefixed token and stable sha256 hash", () => {
    const { token, hash } = generateWebhookToken();
    expect(token.startsWith("awh_")).toBe(true);
    expect(token.length).toBeGreaterThan(20);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashWebhookToken(token)).toBe(hash);
  });

  it("different tokens hash differently", () => {
    const a = generateWebhookToken();
    const b = generateWebhookToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });
});

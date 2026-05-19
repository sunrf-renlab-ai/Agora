import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { _resetKeyCache, decryptToken, encryptToken } from "./token-crypto";

describe("token-crypto", () => {
  const ORIG = process.env.AGORA_TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.AGORA_TOKEN_ENCRYPTION_KEY = "test-key-with-enough-entropy-please-32+";
    _resetKeyCache();
  });

  afterEach(() => {
    process.env.AGORA_TOKEN_ENCRYPTION_KEY = ORIG;
    _resetKeyCache();
  });

  it("round-trips arbitrary string content", () => {
    for (const plain of [
      "hello",
      "🦊 unicode survives",
      "x".repeat(2048),
      "linear_oauth_access_token_lin_oauth_xxxxxxxxxx",
    ]) {
      const enc = encryptToken(plain);
      expect(enc).not.toBe(plain);
      expect(enc).toContain("."); // nonce.payload
      const dec = decryptToken(enc);
      expect(dec).toBe(plain);
    }
  });

  it("each encryption uses a fresh nonce (deterministic plaintext → different ciphertext)", () => {
    const a = encryptToken("same");
    const b = encryptToken("same");
    expect(a).not.toBe(b);
  });

  it("tampered ciphertext fails to decrypt (auth tag rejects)", () => {
    const enc = encryptToken("secret");
    const [nonce, payload] = enc.split(".");
    const tampered = `${nonce}.${(payload ?? "").slice(0, -2)}AA`;
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("missing key throws on first encrypt with a clear message", () => {
    process.env.AGORA_TOKEN_ENCRYPTION_KEY = "";
    _resetKeyCache();
    expect(() => encryptToken("x")).toThrow(/AGORA_TOKEN_ENCRYPTION_KEY/);
  });

  it("invalid encoded format throws", () => {
    expect(() => decryptToken("nodot")).toThrow(/format/);
    expect(() => decryptToken("a.bb")).toThrow(/too short/);
  });
});

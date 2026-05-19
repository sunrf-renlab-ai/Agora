import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric token-at-rest encryption for OAuth refresh + access tokens
 * stored on `user_connection.config`. AES-256-GCM with a 12-byte nonce;
 * the auth tag is appended to the ciphertext.
 *
 * Key derivation: SHA-256 of process.env.AGORA_TOKEN_ENCRYPTION_KEY.
 * If the env var is missing, we deliberately throw on first use
 * rather than silently degrade — encrypted-at-rest is the whole point.
 *
 * Output is base64-encoded "<nonce>.<ciphertext+tag>" so it round-trips
 * cleanly through JSON / Postgres jsonb without escaping.
 */

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.AGORA_TOKEN_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      "AGORA_TOKEN_ENCRYPTION_KEY must be set (32+ random bytes) to encrypt OAuth tokens",
    );
  }
  cachedKey = createHash("sha256").update(raw).digest();
  return cachedKey;
}

export function encryptToken(plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([ct, tag]).toString("base64");
  return `${nonce.toString("base64")}.${payload}`;
}

export function decryptToken(encoded: string): string {
  const dot = encoded.indexOf(".");
  if (dot <= 0) throw new Error("invalid encrypted token format");
  const nonce = Buffer.from(encoded.slice(0, dot), "base64");
  const full = Buffer.from(encoded.slice(dot + 1), "base64");
  if (full.length < 17) throw new Error("ciphertext too short");
  const ct = full.subarray(0, full.length - 16);
  const tag = full.subarray(full.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Reset the cached key. Tests call this after mutating
 * AGORA_TOKEN_ENCRYPTION_KEY.
 */
export function _resetKeyCache(): void {
  cachedKey = null;
}

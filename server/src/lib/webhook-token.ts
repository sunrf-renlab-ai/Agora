import { createHash, randomBytes } from "node:crypto";

export function generateWebhookToken(): { token: string; hash: string } {
  const raw = `awh_${randomBytes(32).toString("base64url")}`;
  return { token: raw, hash: hashWebhookToken(raw) };
}

export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

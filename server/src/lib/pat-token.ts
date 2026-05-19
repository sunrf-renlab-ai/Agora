import { createHash, randomBytes } from "node:crypto";

export function generatePat(): { token: string; hash: string; prefix: string } {
  const raw = `pat_${randomBytes(32).toString("base64url")}`;
  const prefix = raw.slice(0, 8); // "pat_xxxx" — for display, not auth
  return { token: raw, hash: hashPat(raw), prefix };
}

export function hashPat(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

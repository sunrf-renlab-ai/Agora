import { createHash, randomBytes } from "node:crypto";

export function generateMachineToken(): { token: string; hash: string } {
  const raw = `agm_${randomBytes(32).toString("base64url")}`;
  return { token: raw, hash: hashMachineToken(raw) };
}

export function hashMachineToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

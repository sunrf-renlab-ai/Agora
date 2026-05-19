import { SignJWT, jwtVerify } from "jose";

export interface TaskClaims {
  taskId: string;
  agentId: string;
  workspaceId: string;
}

const ISS = "agora-server";
const AUD = "agora-task";

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function mintTaskJwt(
  claims: TaskClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key(secret));
}

export async function verifyTaskJwt(token: string, secret: string): Promise<TaskClaims> {
  const { payload } = await jwtVerify(token, key(secret), { issuer: ISS, audience: AUD });
  return {
    taskId: String(payload.taskId),
    agentId: String(payload.agentId),
    workspaceId: String(payload.workspaceId),
  };
}

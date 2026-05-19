// CLI pair code store, DB-backed.
//
// Was an in-memory Map until users saw /pair/exchange 404 after we'd
// redeployed Render mid-onboarding — the new container's Map was empty,
// the code minted on the previous container was gone. Persistence is
// non-negotiable for any free-tier deploy where the host can restart.
//
// Flow unchanged:
//   1. CLI POST /api/cli/pair/start → server writes a row with no token.
//   2. Browser approves → token + userId fill in.
//   3. CLI POST /api/cli/pair/exchange → reads the token and deletes the row.
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "../db/client";
import { cliPairCodes } from "../db/schema/cli-pair-code";

// 30 min: install.sh downloads a ~63 MB binary then waits on a sudo password,
// then exchanges the code. The whole loop can easily exceed 5 min for users
// on slow connections or those who walked away. Codes are single-use and
// scoped to one user, so a longer window costs nothing.
const TTL_MS = 30 * 60_000;

export interface PendingCode {
  code: string;
  token: string | null;
  userId: string | null;
  expiresAt: number; // ms epoch
}

function makeCode(): string {
  // 8 random uppercase letters/digits with a dash in the middle. Avoid
  // visually ambiguous characters (0/O, 1/I/L) so users typing it don't err.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += "-";
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

async function purgeExpired(): Promise<void> {
  await db.delete(cliPairCodes).where(lt(cliPairCodes.expiresAt, new Date()));
}

function toPending(row: typeof cliPairCodes.$inferSelect): PendingCode {
  return {
    code: row.code,
    token: row.token,
    userId: row.userId,
    expiresAt: row.expiresAt.getTime(),
  };
}

export async function startPair(): Promise<{ code: string; expiresAt: number }> {
  await purgeExpired();
  const expiresAtMs = Date.now() + TTL_MS;
  const expiresAt = new Date(expiresAtMs);

  // Re-roll on PK collision (vanishingly rare with 30^8 keyspace).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const inserted = await db
      .insert(cliPairCodes)
      .values({ code, token: null, userId: null, expiresAt })
      .onConflictDoNothing({ target: cliPairCodes.code })
      .returning();
    if (inserted.length > 0) {
      return { code, expiresAt: expiresAtMs };
    }
  }
  throw new Error("Failed to allocate a pair code after 5 attempts");
}

export async function getPair(code: string): Promise<PendingCode | null> {
  await purgeExpired();
  const [row] = await db
    .select()
    .from(cliPairCodes)
    .where(eq(cliPairCodes.code, code))
    .limit(1);
  return row ? toPending(row) : null;
}

export async function approvePair(
  code: string,
  userId: string,
  token: string,
): Promise<boolean> {
  await purgeExpired();
  const updated = await db
    .update(cliPairCodes)
    .set({ userId, token })
    .where(eq(cliPairCodes.code, code))
    .returning();
  return updated.length > 0;
}

export async function consumePair(
  code: string,
): Promise<{ token: string; userId: string } | null> {
  await purgeExpired();
  // Atomic claim: only delete rows that have already been approved (token
  // and userId populated). Otherwise leave it so the CLI can keep polling.
  const deleted = await db
    .delete(cliPairCodes)
    .where(
      and(
        eq(cliPairCodes.code, code),
        isNotNull(cliPairCodes.token),
        isNotNull(cliPairCodes.userId),
      ),
    )
    .returning();
  const row = deleted[0];
  if (!row || !row.token || !row.userId) return null;
  return { token: row.token, userId: row.userId };
}

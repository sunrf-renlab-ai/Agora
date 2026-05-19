import { createPatSchema } from "@agora/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { personalAccessTokens } from "../db/schema/index";
import { jsonError, notFound } from "../lib/errors";
import { generatePat } from "../lib/pat-token";
import { authMiddleware, requireUser } from "../middleware/auth";

const app = new Hono();
app.use(authMiddleware);
app.use(requireUser);

// Map a DB row to the public-safe shape (no hash, no cleartext).
function patToJson(p: typeof personalAccessTokens.$inferSelect) {
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    tokenPrefix: p.tokenPrefix,
    revoked: p.revoked,
    lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

// GET — list current user's PATs (no cleartext, no hash exposed).
app.get("/api/me/tokens", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, user.id))
    .orderBy(desc(personalAccessTokens.createdAt));
  return c.json(rows.map(patToJson));
});

// POST — generate a new PAT. Cleartext is returned ONCE and never re-shown.
app.post("/api/me/tokens", async (c) => {
  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "Invalid JSON body");
  }
  const parsed = createPatSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const { token, hash, prefix } = generatePat();
  const [row] = await db
    .insert(personalAccessTokens)
    .values({
      userId: user.id,
      name: parsed.data.name,
      tokenHash: hash,
      tokenPrefix: prefix,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    })
    .returning();
  if (!row) return jsonError(c, 500, "Failed to create token");

  return c.json({ ...patToJson(row), token }, 201);
});

// POST /:tokenId/revoke — soft-delete by setting revoked=true. Owner only.
app.post("/api/me/tokens/:tokenId/revoke", async (c) => {
  const user = c.get("user");
  const id = c.req.param("tokenId");
  const existing = await db.query.personalAccessTokens.findFirst({
    where: and(eq(personalAccessTokens.id, id), eq(personalAccessTokens.userId, user.id)),
  });
  if (!existing) return notFound(c, "Token");

  const [row] = await db
    .update(personalAccessTokens)
    .set({ revoked: true })
    .where(eq(personalAccessTokens.id, id))
    .returning();
  if (!row) return jsonError(c, 500, "Failed to revoke token");
  return c.json(patToJson(row));
});

export default app;

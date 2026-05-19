import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import { users } from "../db/schema/users";
import { jsonError, notFound } from "../lib/errors";
import { authMiddleware, requireUser } from "../middleware/auth";

const app = new Hono();
app.use(authMiddleware);
app.use(requireUser);

function userToJson(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    onboardedAt: u.onboardedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

app.get("/api/me", async (c) => {
  const authUser = c.get("user");
  const user = await db.query.users.findFirst({ where: eq(users.id, authUser.id) });
  if (!user) return notFound(c, "User");
  return c.json(userToJson(user));
});

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

app.patch("/api/me", async (c) => {
  const authUser = c.get("user");
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const [updated] = await db
    .update(users)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(users.id, authUser.id))
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: returning() always yields a row after update
  return c.json(userToJson(updated!));
});

export default app;

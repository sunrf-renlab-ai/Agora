import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPreferences,
  updateNotificationPreferencesSchema,
} from "@agora/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { users } from "../db/schema/users";
import { jsonError, notFound } from "../lib/errors";
import { authMiddleware, requireUser } from "../middleware/auth";

const app = new Hono();
app.use(authMiddleware);
app.use(requireUser);

function mergePrefs(stored: unknown): NotificationPreferences {
  const incoming = (stored ?? {}) as Partial<NotificationPreferences>;
  return { ...DEFAULT_NOTIFICATION_PREFS, ...incoming };
}

app.get("/api/me/notification-preferences", async (c) => {
  const authUser = c.get("user");
  const user = await db.query.users.findFirst({ where: eq(users.id, authUser.id) });
  if (!user) return notFound(c, "User");
  return c.json(mergePrefs(user.notificationPreferences));
});

app.patch("/api/me/notification-preferences", async (c) => {
  const authUser = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "Invalid JSON body");
  }
  const parsed = updateNotificationPreferencesSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const user = await db.query.users.findFirst({ where: eq(users.id, authUser.id) });
  if (!user) return notFound(c, "User");

  const current = mergePrefs(user.notificationPreferences);
  const next: NotificationPreferences = { ...current, ...parsed.data };

  const [updated] = await db
    .update(users)
    .set({ notificationPreferences: next, updatedAt: new Date() })
    .where(eq(users.id, authUser.id))
    .returning();
  if (!updated) return jsonError(c, 500, "Failed to update notification preferences");

  return c.json(mergePrefs(updated.notificationPreferences));
});

export default app;

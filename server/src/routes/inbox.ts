import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { inboxItems } from "../db/schema/index";
import { notFound } from "../lib/errors";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

function itemToJson(item: typeof inboxItems.$inferSelect) {
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    recipientKind: item.recipientKind,
    recipientId: item.recipientId,
    type: item.type,
    severity: item.severity,
    issueId: item.issueId,
    title: item.title,
    body: item.body,
    read: item.read,
    archived: item.archived,
    createdAt: item.createdAt.toISOString(),
  };
}

// GET /api/workspaces/:workspaceId/inbox
app.get("/api/workspaces/:workspaceId/inbox", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const archived = c.req.query("archived") === "true";

  const rows = await db.query.inboxItems.findMany({
    where: and(
      eq(inboxItems.workspaceId, workspaceId),
      eq(inboxItems.recipientId, user.id),
      eq(inboxItems.archived, archived),
    ),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 50,
  });
  return c.json(rows.map(itemToJson));
});

// POST /api/workspaces/:workspaceId/inbox/mark-all-read — MUST be before /:itemId
app.post("/api/workspaces/:workspaceId/inbox/mark-all-read", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");

  await db
    .update(inboxItems)
    .set({ read: true })
    .where(
      and(
        eq(inboxItems.workspaceId, workspaceId),
        eq(inboxItems.recipientId, user.id),
        eq(inboxItems.read, false),
      ),
    );

  return c.json({ ok: true });
});

// POST /api/workspaces/:workspaceId/inbox/archive-all — archive everything
// in this user's inbox (or scoped via ?scope=read for read-only).
app.post("/api/workspaces/:workspaceId/inbox/archive-all", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const scope = c.req.query("scope") ?? "all";

  const conditions = [
    eq(inboxItems.workspaceId, workspaceId),
    eq(inboxItems.recipientId, user.id),
    eq(inboxItems.archived, false),
  ];
  if (scope === "read") conditions.push(eq(inboxItems.read, true));

  await db.update(inboxItems).set({ archived: true }).where(and(...conditions));
  return c.json({ ok: true });
});

// PATCH /api/workspaces/:workspaceId/inbox/:itemId (mark read/archived)
app.patch("/api/workspaces/:workspaceId/inbox/:itemId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const itemId = c.req.param("itemId");
  const body = await c.req.json().catch(() => ({}));

  const item = await db.query.inboxItems.findFirst({
    where: and(
      eq(inboxItems.id, itemId),
      eq(inboxItems.workspaceId, workspaceId),
      eq(inboxItems.recipientId, user.id),
    ),
  });
  if (!item) return notFound(c, "Inbox item");

  const update: Partial<typeof inboxItems.$inferInsert> = {};
  if (typeof body.read === "boolean") update.read = body.read;
  if (typeof body.archived === "boolean") update.archived = body.archived;

  const [updated] = await db
    .update(inboxItems)
    .set(update)
    .where(and(eq(inboxItems.id, itemId), eq(inboxItems.recipientId, user.id)))
    .returning();
  if (!updated) return notFound(c, "Inbox item");
  return c.json(itemToJson(updated));
});

export default app;

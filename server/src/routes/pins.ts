import { createPinSchema } from "@agora/shared";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { pins } from "../db/schema/index";
import { forbidden, jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

const pinToJson = (p: typeof pins.$inferSelect) => ({
  id: p.id,
  workspaceId: p.workspaceId,
  userId: p.userId,
  itemType: p.itemType,
  itemId: p.itemId,
  position: p.position,
  createdAt: p.createdAt.toISOString(),
});

// GET — list current user's pins in this workspace, ordered by position then createdAt
app.get("/api/workspaces/:workspaceId/pins", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const rows = await db
    .select()
    .from(pins)
    .where(and(eq(pins.workspaceId, workspaceId), eq(pins.userId, user.id)))
    .orderBy(asc(pins.position), asc(pins.createdAt));
  return c.json(rows.map(pinToJson));
});

// POST — create pin (idempotent on (user, workspace, itemType, itemId)).
// Position auto-increments to be the next one after the user's existing pins.
app.post("/api/workspaces/:workspaceId/pins", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "Invalid JSON body");
  }
  const parsed = createPinSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const existing = await db.query.pins.findFirst({
    where: and(
      eq(pins.workspaceId, workspaceId),
      eq(pins.userId, user.id),
      eq(pins.itemType, parsed.data.itemType),
      eq(pins.itemId, parsed.data.itemId),
    ),
  });
  if (existing) return c.json(pinToJson(existing));

  // Compute next position = max(position) + 1 across this user's pins in this workspace
  const userPins = await db
    .select()
    .from(pins)
    .where(and(eq(pins.workspaceId, workspaceId), eq(pins.userId, user.id)));
  const nextPosition = userPins.length ? Math.max(...userPins.map((p) => p.position)) + 1 : 0;

  const [row] = await db
    .insert(pins)
    .values({
      workspaceId,
      userId: user.id,
      itemType: parsed.data.itemType,
      itemId: parsed.data.itemId,
      position: nextPosition,
    })
    .returning();
  if (!row) return jsonError(c, 500, "Failed to create pin");

  broadcastWorkspace(workspaceId, {
    type: "pin.created",
    data: { id: row.id, userId: user.id, workspaceId },
  });
  return c.json(pinToJson(row), 201);
});

// DELETE — remove pin (owner only)
app.delete("/api/workspaces/:workspaceId/pins/:pinId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const id = c.req.param("pinId");
  const row = await db.query.pins.findFirst({
    where: and(eq(pins.id, id), eq(pins.workspaceId, workspaceId)),
  });
  if (!row) return notFound(c, "Pin");
  if (row.userId !== user.id) return forbidden(c);
  await db.delete(pins).where(eq(pins.id, id));
  broadcastWorkspace(workspaceId, {
    type: "pin.deleted",
    data: { id, userId: user.id, workspaceId },
  });
  return c.body(null, 204);
});

export default app;

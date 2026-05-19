import { createAttachmentSchema, signAttachmentUploadSchema } from "@agora/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { attachments } from "../db/schema/index";
import { forbidden, jsonError, notFound } from "../lib/errors";
import { createSignedDownloadUrl, createSignedUploadUrl, deleteFromStorage } from "../lib/storage";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

const attachmentToJson = (a: typeof attachments.$inferSelect) => ({
  id: a.id,
  workspaceId: a.workspaceId,
  ownerKind: a.ownerKind,
  ownerId: a.ownerId,
  filename: a.filename,
  contentType: a.contentType,
  size: a.size,
  storageKey: a.storageKey,
  createdByUserId: a.createdByUserId,
  createdAt: a.createdAt.toISOString(),
});

// POST /api/workspaces/:workspaceId/attachments/sign-upload
// Step 1 of upload: client asks for a signed PUT URL pointing into the bucket.
app.post("/api/workspaces/:workspaceId/attachments/sign-upload", async (c) => {
  const workspaceId = c.get("workspaceId");
  const body = await c.req.json();
  const parsed = signAttachmentUploadSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  try {
    const result = await createSignedUploadUrl(
      workspaceId,
      parsed.data.ownerKind,
      parsed.data.ownerId,
      parsed.data.filename,
    );
    return c.json(result, 201);
  } catch (e) {
    return jsonError(c, 500, `Failed to sign upload: ${(e as Error).message}`);
  }
});

// POST /api/workspaces/:workspaceId/attachments
// Step 2 of upload: client (after PUT succeeded) records the metadata row.
app.post("/api/workspaces/:workspaceId/attachments", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = createAttachmentSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  // Sanity: the storage key must be scoped to this workspace + owner triple.
  const expectedPrefix = `${workspaceId}/${parsed.data.ownerKind}/${parsed.data.ownerId}/`;
  if (!parsed.data.storageKey.startsWith(expectedPrefix))
    return jsonError(c, 400, "storageKey is not in the expected workspace/owner namespace");

  const [row] = await db
    .insert(attachments)
    .values({
      workspaceId,
      ownerKind: parsed.data.ownerKind,
      ownerId: parsed.data.ownerId,
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
      storageKey: parsed.data.storageKey,
      createdByUserId: user.id,
    })
    .returning();
  if (!row) return jsonError(c, 500, "Failed to record attachment");
  broadcastWorkspace(workspaceId, {
    type: "attachment.added",
    data: {
      id: row.id,
      ownerKind: row.ownerKind,
      ownerId: row.ownerId,
      workspaceId,
    },
  });
  return c.json(attachmentToJson(row), 201);
});

// GET /api/workspaces/:workspaceId/attachments?ownerKind=&ownerId=
app.get("/api/workspaces/:workspaceId/attachments", async (c) => {
  const workspaceId = c.get("workspaceId");
  const ownerKind = c.req.query("ownerKind");
  const ownerId = c.req.query("ownerId");
  if (!ownerKind || !ownerId) return jsonError(c, 400, "ownerKind and ownerId are required");
  if (ownerKind !== "issue" && ownerKind !== "comment" && ownerKind !== "chat_message")
    return jsonError(c, 400, "invalid ownerKind");
  const rows = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.workspaceId, workspaceId),
        eq(attachments.ownerKind, ownerKind),
        eq(attachments.ownerId, ownerId),
      ),
    )
    .orderBy(desc(attachments.createdAt));
  return c.json(rows.map(attachmentToJson));
});

// GET /api/workspaces/:workspaceId/attachments/:id/download
app.get("/api/workspaces/:workspaceId/attachments/:id/download", async (c) => {
  const workspaceId = c.get("workspaceId");
  const id = c.req.param("id");
  const row = await db.query.attachments.findFirst({
    where: and(eq(attachments.id, id), eq(attachments.workspaceId, workspaceId)),
  });
  if (!row) return notFound(c, "Attachment");
  try {
    const url = await createSignedDownloadUrl(row.storageKey);
    return c.json({ url, expiresInSeconds: 5 * 60, filename: row.filename });
  } catch (e) {
    return jsonError(c, 500, `Failed to sign download: ${(e as Error).message}`);
  }
});

// DELETE /api/workspaces/:workspaceId/attachments/:id (owner OR workspace admin/owner)
app.delete("/api/workspaces/:workspaceId/attachments/:id", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const id = c.req.param("id");
  const row = await db.query.attachments.findFirst({
    where: and(eq(attachments.id, id), eq(attachments.workspaceId, workspaceId)),
  });
  if (!row) return notFound(c, "Attachment");
  if (role === "member" && row.createdByUserId !== user.id) return forbidden(c);

  await db.delete(attachments).where(eq(attachments.id, id));
  // Best-effort storage deletion; if it fails, the metadata is gone but the blob lingers.
  try {
    await deleteFromStorage(row.storageKey);
  } catch {
    /* ignore */
  }
  broadcastWorkspace(workspaceId, {
    type: "attachment.removed",
    data: {
      id,
      ownerKind: row.ownerKind,
      ownerId: row.ownerId,
      workspaceId,
    },
  });
  return c.body(null, 204);
});

export default app;

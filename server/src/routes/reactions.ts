import { addReactionSchema } from "@agora/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { commentReactions, comments, issueReactions, issues } from "../db/schema/index";
import { jsonError, notFound } from "../lib/errors";
import { broadcastWorkspace } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

const issueReactionToJson = (r: typeof issueReactions.$inferSelect) => ({
  id: r.id,
  workspaceId: r.workspaceId,
  targetKind: "issue" as const,
  targetId: r.issueId,
  actorKind: r.actorKind,
  actorId: r.actorId,
  emoji: r.emoji,
  createdAt: r.createdAt.toISOString(),
});

const commentReactionToJson = (r: typeof commentReactions.$inferSelect) => ({
  id: r.id,
  workspaceId: r.workspaceId,
  targetKind: "comment" as const,
  targetId: r.commentId,
  actorKind: r.actorKind,
  actorId: r.actorId,
  emoji: r.emoji,
  createdAt: r.createdAt.toISOString(),
});

// GET issue reactions
app.get("/api/workspaces/:workspaceId/issues/:issueId/reactions", async (c) => {
  const issueId = c.req.param("issueId");
  const rows = await db.query.issueReactions.findMany({
    where: eq(issueReactions.issueId, issueId),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
  return c.json(rows.map(issueReactionToJson));
});

// POST issue reaction (idempotent: 200 if already exists, 201 if newly added)
app.post("/api/workspaces/:workspaceId/issues/:issueId/reactions", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const issueId = c.req.param("issueId");
  const body = await c.req.json();
  const parsed = addReactionSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const inserted = await db
    .insert(issueReactions)
    .values({
      workspaceId,
      issueId,
      actorKind: "member",
      actorId: user.id,
      emoji: parsed.data.emoji,
    })
    .onConflictDoNothing()
    .returning();

  let row: typeof issueReactions.$inferSelect | undefined = inserted[0];
  if (!row) {
    row = await db.query.issueReactions.findFirst({
      where: and(
        eq(issueReactions.issueId, issueId),
        eq(issueReactions.actorKind, "member"),
        eq(issueReactions.actorId, user.id),
        eq(issueReactions.emoji, parsed.data.emoji),
      ),
    });
  }
  if (!row) return jsonError(c, 500, "Failed to add reaction");

  if (inserted[0]) {
    broadcastWorkspace(workspaceId, {
      type: "reaction.added",
      data: {
        targetKind: "issue",
        targetId: issueId,
        emoji: parsed.data.emoji,
        workspaceId,
      },
    });
  }
  return c.json(issueReactionToJson(row), inserted[0] ? 201 : 200);
});

// DELETE issue reaction (by emoji + current user)
app.delete("/api/workspaces/:workspaceId/issues/:issueId/reactions/:emoji", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const issueId = c.req.param("issueId");
  const emoji = decodeURIComponent(c.req.param("emoji"));
  await db
    .delete(issueReactions)
    .where(
      and(
        eq(issueReactions.issueId, issueId),
        eq(issueReactions.actorKind, "member"),
        eq(issueReactions.actorId, user.id),
        eq(issueReactions.emoji, emoji),
      ),
    );
  broadcastWorkspace(workspaceId, {
    type: "reaction.removed",
    data: { targetKind: "issue", targetId: issueId, emoji, workspaceId },
  });
  return c.body(null, 204);
});

// GET comment reactions
app.get("/api/workspaces/:workspaceId/comments/:commentId/reactions", async (c) => {
  const commentId = c.req.param("commentId");
  const rows = await db.query.commentReactions.findMany({
    where: eq(commentReactions.commentId, commentId),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
  return c.json(rows.map(commentReactionToJson));
});

// POST comment reaction
app.post("/api/workspaces/:workspaceId/comments/:commentId/reactions", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const commentId = c.req.param("commentId");
  const body = await c.req.json();
  const parsed = addReactionSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const comment = await db.query.comments.findFirst({ where: eq(comments.id, commentId) });
  if (!comment) return notFound(c, "Comment");

  const inserted = await db
    .insert(commentReactions)
    .values({
      workspaceId,
      commentId,
      actorKind: "member",
      actorId: user.id,
      emoji: parsed.data.emoji,
    })
    .onConflictDoNothing()
    .returning();

  let row: typeof commentReactions.$inferSelect | undefined = inserted[0];
  if (!row) {
    row = await db.query.commentReactions.findFirst({
      where: and(
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.actorKind, "member"),
        eq(commentReactions.actorId, user.id),
        eq(commentReactions.emoji, parsed.data.emoji),
      ),
    });
  }
  if (!row) return jsonError(c, 500, "Failed to add reaction");

  if (inserted[0]) {
    broadcastWorkspace(workspaceId, {
      type: "reaction.added",
      data: {
        targetKind: "comment",
        targetId: commentId,
        emoji: parsed.data.emoji,
        workspaceId,
      },
    });
  }
  return c.json(commentReactionToJson(row), inserted[0] ? 201 : 200);
});

// DELETE comment reaction
app.delete("/api/workspaces/:workspaceId/comments/:commentId/reactions/:emoji", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const commentId = c.req.param("commentId");
  const emoji = decodeURIComponent(c.req.param("emoji"));
  await db
    .delete(commentReactions)
    .where(
      and(
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.actorKind, "member"),
        eq(commentReactions.actorId, user.id),
        eq(commentReactions.emoji, emoji),
      ),
    );
  broadcastWorkspace(workspaceId, {
    type: "reaction.removed",
    data: { targetKind: "comment", targetId: commentId, emoji, workspaceId },
  });
  return c.body(null, 204);
});

export default app;

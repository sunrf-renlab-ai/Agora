import { createCommentSchema, updateCommentSchema } from "@agora/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { agents, comments, issues, users, workspaces } from "../db/schema/index";
import { logActivity } from "../lib/activity";
import { enqueueTaskForIssue } from "../lib/enqueue";
import { forbidden, jsonError, notFound } from "../lib/errors";
import { hasMentionAll, parseMentions } from "../lib/mention";
import { ensureSubscribed, extractMentionedUserIds, notifySubscribers } from "../lib/subscribe";
import { hub } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

async function commentToJson(comment: typeof comments.$inferSelect) {
  const author = await db.query.users.findFirst({ where: eq(users.id, comment.authorId) });
  return {
    id: comment.id,
    issueId: comment.issueId,
    authorKind: comment.authorKind,
    authorId: comment.authorId,
    author: author
      ? { id: author.id, name: author.name, email: author.email, avatarUrl: author.avatarUrl }
      : null,
    content: comment.content,
    type: comment.type,
    parentCommentId: comment.parentCommentId,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

// GET /api/workspaces/:workspaceId/issues/:issueId/comments
app.get("/api/workspaces/:workspaceId/issues/:issueId/comments", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const rows = await db.query.comments.findMany({
    where: eq(comments.issueId, issueId),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });

  return c.json(await Promise.all(rows.map(commentToJson)));
});

// POST /api/workspaces/:workspaceId/issues/:issueId/comments
app.post("/api/workspaces/:workspaceId/issues/:issueId/comments", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const issueId = c.req.param("issueId");
  const body = await c.req.json();
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const [comment] = await db
    .insert(comments)
    .values({
      issueId,
      authorKind: "member",
      authorId: user.id,
      content: parsed.data.content,
      parentCommentId: parsed.data.parentCommentId ?? null,
    })
    .returning();

  if (!comment) return jsonError(c, 500, "Failed to create comment");

  // Auto-subscribe commenter
  await ensureSubscribed(issueId, "member", user.id, "commenter");

  // Auto-subscribe @mentioned members (no-op currently — no handle column)
  const mentionedIds = await extractMentionedUserIds(workspaceId, parsed.data.content);
  for (const mentionedId of mentionedIds) {
    if (mentionedId !== user.id) {
      await ensureSubscribed(issueId, "member", mentionedId, "mentioned");
    }
  }

  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  const identifier = ws ? `${ws.issuePrefix}-${issue.number}` : `#${issue.number}`;

  // Notify subscribers (excluding commenter)
  await notifySubscribers(
    workspaceId,
    issueId,
    user.id,
    "issue_comment",
    `New comment on ${identifier}: ${issue.title}`,
    parsed.data.content.slice(0, 200),
  );

  // Agent mention trigger: enqueue task for each @agent mentioned in the comment
  const mentions = parseMentions(parsed.data.content);

  const mentionedAgentIds = mentions.filter((m) => m.kind === "agent").map((m) => m.id);
  if (mentionedAgentIds.length > 0) {
    const candidates = await db.query.agents.findMany({
      where: and(eq(agents.workspaceId, workspaceId), inArray(agents.id, mentionedAgentIds)),
    });
    for (const a of candidates) {
      if (!a.runtimeId || a.archivedAt) continue;
      try {
        await enqueueTaskForIssue({
          workspaceId,
          issueId,
          agentId: a.id,
          runtimeId: a.runtimeId,
          triggerCommentId: comment.id,
          triggerSummary: "mentioned in comment",
        });
      } catch {
        // duplicate active task — ignore
      }
    }
  }

  // on_comment trigger: enqueue task for the assigned agent if not already triggered by mention
  if (issue.assigneeKind === "agent" && issue.assigneeId) {
    const assigneeMentioned = mentions.some((m) => m.kind === "agent" && m.id === issue.assigneeId);
    const otherButNotAssignee = mentions
      .filter((m) => m.kind !== "issue")
      .some((m) => !(m.kind === "agent" && m.id === issue.assigneeId));
    const isOthersOnly = !assigneeMentioned && (otherButNotAssignee || hasMentionAll(mentions));
    if (!isOthersOnly && !mentionedAgentIds.includes(issue.assigneeId)) {
      const assignee = await db.query.agents.findFirst({
        where: eq(agents.id, issue.assigneeId),
      });
      if (assignee?.runtimeId && !assignee.archivedAt) {
        try {
          await enqueueTaskForIssue({
            workspaceId,
            issueId,
            agentId: assignee.id,
            runtimeId: assignee.runtimeId,
            triggerCommentId: comment.id,
            triggerSummary: "on_comment trigger",
          });
        } catch {
          // duplicate active task — ignore
        }
      }
    }
  }

  await logActivity(workspaceId, "member", user.id, "comment.created", {}, issueId);

  hub.broadcast(`workspace:${workspaceId}`, {
    type: "comment.created",
    data: { id: comment.id, issueId },
  });

  return c.json(await commentToJson(comment), 201);
});

// PATCH /api/workspaces/:workspaceId/issues/:issueId/comments/:commentId
app.patch("/api/workspaces/:workspaceId/issues/:issueId/comments/:commentId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const issueId = c.req.param("issueId");
  const commentId = c.req.param("commentId");
  const body = await c.req.json();
  const parsed = updateCommentSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  // Verify issue belongs to workspace
  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const comment = await db.query.comments.findFirst({
    where: and(eq(comments.id, commentId), eq(comments.issueId, issueId)),
  });
  if (!comment) return notFound(c, "Comment");
  if (comment.authorId !== user.id) return forbidden(c);

  const [updated] = await db
    .update(comments)
    .set({ content: parsed.data.content, updatedAt: new Date() })
    .where(and(eq(comments.id, commentId), eq(comments.issueId, issueId)))
    .returning();

  if (!updated) return notFound(c, "Comment");
  return c.json(await commentToJson(updated));
});

// DELETE /api/workspaces/:workspaceId/issues/:issueId/comments/:commentId
app.delete("/api/workspaces/:workspaceId/issues/:issueId/comments/:commentId", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const issueId = c.req.param("issueId");
  const commentId = c.req.param("commentId");

  // Verify issue belongs to workspace
  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const comment = await db.query.comments.findFirst({
    where: and(eq(comments.id, commentId), eq(comments.issueId, issueId)),
  });
  if (!comment) return notFound(c, "Comment");

  // Owner/admin can delete any comment; member can only delete their own
  if (role === "member" && comment.authorId !== user.id) return forbidden(c);

  await db.delete(comments).where(and(eq(comments.id, commentId), eq(comments.issueId, issueId)));
  return c.body(null, 204);
});

export default app;

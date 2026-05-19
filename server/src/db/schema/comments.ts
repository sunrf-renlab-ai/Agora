import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const comments = pgTable(
  "comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id").notNull(),
    authorKind: text("author_kind", { enum: ["member", "agent"] }).notNull(),
    authorId: uuid("author_id").notNull(),
    content: text("content").notNull(),
    type: text("type", {
      enum: ["comment", "status_change", "progress_update", "system"],
    })
      .notNull()
      .default("comment"),
    parentCommentId: uuid("parent_comment_id"),
    triggerCommentId: uuid("trigger_comment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_comment_issue").on(t.issueId)],
);

export const commentReactions = pgTable(
  "comment_reaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    commentId: uuid("comment_id").notNull(),
    actorKind: text("actor_kind", { enum: ["member", "agent"] }).notNull(),
    actorId: uuid("actor_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_comment_reaction").on(t.commentId, t.actorKind, t.actorId, t.emoji),
    index("idx_comment_reaction_comment").on(t.commentId),
  ],
);

export const issueReactions = pgTable(
  "issue_reaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    actorKind: text("actor_kind", { enum: ["member", "agent"] }).notNull(),
    actorId: uuid("actor_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_issue_reaction").on(t.issueId, t.actorKind, t.actorId, t.emoji),
    index("idx_issue_reaction_issue").on(t.issueId),
  ],
);

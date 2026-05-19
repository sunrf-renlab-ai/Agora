import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const attachments = pgTable(
  "attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    ownerKind: text("owner_kind", { enum: ["issue", "comment", "chat_message"] }).notNull(),
    ownerId: uuid("owner_id").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_attachment_owner").on(t.ownerKind, t.ownerId)],
);

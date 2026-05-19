import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const inboxItems = pgTable(
  "inbox_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    recipientKind: text("recipient_kind", { enum: ["member", "agent"] }).notNull(),
    recipientId: uuid("recipient_id").notNull(),
    type: text("type").notNull(),
    severity: text("severity", { enum: ["action_required", "attention", "info"] })
      .notNull()
      .default("info"),
    issueId: uuid("issue_id"),
    title: text("title").notNull(),
    body: text("body"),
    read: boolean("read").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_inbox_recipient").on(t.recipientId, t.read, t.archived)],
);

export const notificationPreferences = pgTable("notification_preference", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  preferences: jsonb("preferences").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

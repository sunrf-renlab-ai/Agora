import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const pins = pgTable("pin", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  userId: uuid("user_id").notNull(),
  itemType: text("item_type", { enum: ["issue", "project", "agent"] }).notNull(),
  itemId: uuid("item_id").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

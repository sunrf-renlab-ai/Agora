import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    issueId: uuid("issue_id"),
    actorKind: text("actor_kind", { enum: ["member", "agent", "system"] }),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_activity_workspace").on(t.workspaceId)],
);

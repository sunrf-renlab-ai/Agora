import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { members } from "./members";
import { workspaces } from "./workspaces";

export const runtimes = pgTable(
  "runtime",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    daemonVersion: text("daemon_version").notNull().default(""),
    machineTokenHash: text("machine_token_hash").notNull().unique(),
    detectedClis: jsonb("detected_clis").notNull().default([]),
    online: boolean("online").notNull().default(false),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    runtimeInfo: jsonb("runtime_info").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_runtime_member_name").on(t.workspaceId, t.memberId, t.name),
    index("idx_runtime_workspace").on(t.workspaceId),
  ],
);

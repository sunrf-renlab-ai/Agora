import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { runtimes } from "./runtimes";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const chatSessions = pgTable(
  "chat_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runtimeId: uuid("runtime_id").references(() => runtimes.id),
    title: text("title").notNull().default(""),
    sessionId: text("session_id"),
    workDir: text("work_dir"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_chat_session_workspace").on(t.workspaceId),
    index("idx_chat_session_creator").on(t.creatorId, t.workspaceId),
  ],
);

export const chatMessages = pgTable(
  "chat_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatSessionId: uuid("chat_session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    taskId: uuid("task_id"),
    failureReason: text("failure_reason"),
    elapsedMs: integer("elapsed_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_chat_message_session").on(t.chatSessionId, t.createdAt)],
);

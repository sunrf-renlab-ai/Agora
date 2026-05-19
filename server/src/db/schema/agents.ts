import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { runtimes } from "./runtimes";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const agents = pgTable(
  "agent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    instructions: text("instructions").notNull().default(""),
    avatarUrl: text("avatar_url"),
    visibility: text("visibility", { enum: ["workspace", "private"] })
      .notNull()
      .default("private"),
    runtimeId: uuid("runtime_id").references(() => runtimes.id, { onDelete: "set null" }),
    cliKind: text("cli_kind", {
      enum: ["claude_code", "codex", "gemini", "openclaw", "hermes"],
    })
      .notNull()
      .default("claude_code"),
    runtimeConfig: jsonb("runtime_config").notNull().default({}),
    model: text("model"),
    customEnv: jsonb("custom_env").notNull().default({}),
    customArgs: jsonb("custom_args").notNull().default([]),
    mcpConfig: jsonb("mcp_config").notNull().default({}),
    maxConcurrentTasks: integer("max_concurrent_tasks").notNull().default(1),
    /**
     * Optional per-issue-state concurrency cap. Shape: `{ "in_progress": 5, "in_review": 1 }`.
     * Falls back to `maxConcurrentTasks` when no entry for the current state.
     */
    concurrencyByState: jsonb("concurrency_by_state").notNull().default({}),
    /**
     * Optional per-trigger Liquid prompt templates. Shape:
     * `{ issue?: string, comment?: string, quick_create?: string, autopilot?: string, chat?: string }`
     * — when a key is set, the daemon renders that template via shared/template
     * instead of using the hardcoded builders in local/src/prompts.ts. Strict
     * mode (unknown vars/filters throw); failures map to error_kind=prompt_render_error.
     */
    promptTemplates: jsonb("prompt_templates").notNull().default({}),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_agent_workspace_active").on(t.workspaceId),
    index("idx_agent_owner").on(t.ownerId),
  ],
);

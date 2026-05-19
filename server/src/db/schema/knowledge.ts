import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";
import { workspaces } from "./workspaces";

/**
 * Workspace-shared markdown docs. Sibling of `skills`: same shape
 * (workspace + title + content) so the same hooks/UI primitives slot
 * in. Wave B will let agent runtimes inject these into CLAUDE.md the
 * way `agentSkills` already does.
 */
export const workspaceKnowledgeDocs = pgTable(
  "workspace_knowledge_doc",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /**
     * Optional project scope. NULL = workspace-wide doc visible to
     * everyone in the workspace; set = doc only surfaces inside that
     * project's detail page and gets injected into agent CLAUDE.md
     * only for tasks on that project's issues.
     */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["general", "faq", "decision", "runbook", "onboarding"],
    })
      .notNull()
      .default("general"),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_kb_workspace_updated").on(t.workspaceId, t.updatedAt),
    index("idx_kb_workspace_kind").on(t.workspaceId, t.kind),
    index("idx_kb_workspace_project").on(t.workspaceId, t.projectId, t.updatedAt),
  ],
);

/**
 * Per-user connections to external data sources (Linear / GitHub /
 * Notion / Slack). MVP keeps the table empty — the UI lists supported
 * kinds as cards with stubbed Connect buttons. The schema lives now
 * so the OAuth phase doesn't need a migration.
 *
 * Connections are user-scoped (NOT workspace-scoped) — the user's
 * Linear account is the same across all their workspaces.
 */
export const userConnections = pgTable(
  "user_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["linear", "github", "notion", "slack"] }).notNull(),
    status: text("status", { enum: ["pending", "connected", "revoked"] })
      .notNull()
      .default("pending"),
    /** Token metadata, scopes, account label — never raw secrets. */
    config: jsonb("config").notNull().default({}),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_user_connection_kind").on(t.userId, t.kind)],
);

import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { issues } from "./issues";
import { agentTaskQueue } from "./tasks";
import { workspaces } from "./workspaces";

export const autopilots = pgTable(
  "autopilot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    assigneeId: uuid("assignee_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "paused", "archived"] })
      .notNull()
      .default("active"),
    executionMode: text("execution_mode", { enum: ["create_issue", "run_only"] })
      .notNull()
      .default("create_issue"),
    issueTitleTemplate: text("issue_title_template"),
    createdByKind: text("created_by_kind", { enum: ["member", "agent"] }).notNull(),
    createdById: uuid("created_by_id").notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_autopilot_workspace").on(t.workspaceId),
    index("idx_autopilot_assignee").on(t.assigneeId),
  ],
);

export const autopilotTriggers = pgTable(
  "autopilot_trigger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    autopilotId: uuid("autopilot_id")
      .notNull()
      .references(() => autopilots.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["schedule", "webhook", "api"] }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    cronExpression: text("cron_expression"),
    timezone: text("timezone").default("UTC"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    // sha256 of the cleartext webhook token (cleartext shown ONCE on creation,
    // like machine tokens — see lib/machine-token.ts).
    webhookTokenHash: text("webhook_token_hash").unique(),
    label: text("label"),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_autopilot_trigger_autopilot").on(t.autopilotId),
    // Partial index used by the scheduler claim query (see services/autopilot-scheduler.ts).
    // Drizzle's .where() on .index() requires a raw SQL string — see drizzle-kit docs.
    index("idx_autopilot_trigger_next_run").on(t.nextRunAt),
  ],
);

export const autopilotRuns = pgTable(
  "autopilot_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    autopilotId: uuid("autopilot_id")
      .notNull()
      .references(() => autopilots.id, { onDelete: "cascade" }),
    triggerId: uuid("trigger_id").references(() => autopilotTriggers.id, {
      onDelete: "set null",
    }),
    source: text("source", { enum: ["schedule", "manual", "webhook", "api"] }).notNull(),
    // No 'pending' / 'skipped' states. issue_created is the entry state for
    // execution_mode=create_issue; running for run_only.
    status: text("status", {
      enum: ["issue_created", "running", "completed", "failed"],
    })
      .notNull()
      .default("issue_created"),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => agentTaskQueue.id, { onDelete: "set null" }),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    triggerPayload: jsonb("trigger_payload"),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_autopilot_run_autopilot").on(t.autopilotId, t.createdAt),
    index("idx_autopilot_run_issue").on(t.issueId),
  ],
);

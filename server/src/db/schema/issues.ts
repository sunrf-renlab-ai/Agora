import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const issues = pgTable(
  "issue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"],
    })
      .notNull()
      .default("backlog"),
    priority: text("priority", { enum: ["urgent", "high", "medium", "low", "none"] })
      .notNull()
      .default("none"),
    assigneeKind: text("assignee_kind", { enum: ["member", "agent"] }),
    assigneeId: uuid("assignee_id"),
    creatorKind: text("creator_kind", { enum: ["member", "agent"] }).notNull(),
    creatorId: uuid("creator_id").notNull(),
    parentIssueId: uuid("parent_issue_id"),
    projectId: uuid("project_id"),
    originType: text("origin_type", { enum: ["autopilot", "quick_create"] }),
    originId: uuid("origin_id"),
    acceptanceCriteria: jsonb("acceptance_criteria").notNull().default([]),
    contextRefs: jsonb("context_refs").notNull().default([]),
    position: real("position").notNull().default(0),
    dueDate: timestamp("due_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_issue_workspace").on(t.workspaceId),
    index("idx_issue_status").on(t.workspaceId, t.status),
    unique("uq_issue_number").on(t.workspaceId, t.number),
  ],
);

export const issueLabels = pgTable(
  "issue_label",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("uq_label_workspace_name").on(t.workspaceId, t.name)],
);

export const issueToLabel = pgTable(
  "issue_to_label",
  {
    issueId: uuid("issue_id").notNull(),
    labelId: uuid("label_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.labelId] }),
    index("idx_issue_to_label_workspace").on(t.workspaceId),
  ],
);

export const issueDependencies = pgTable(
  "issue_dependency",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    dependsOnIssueId: uuid("depends_on_issue_id").notNull(),
    type: text("type", { enum: ["blocks", "related"] }).notNull(),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_dep_pair_type").on(t.issueId, t.dependsOnIssueId, t.type),
    index("idx_dep_issue").on(t.issueId),
    index("idx_dep_target").on(t.dependsOnIssueId),
  ],
);

export const issueSubscribers = pgTable(
  "issue_subscriber",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id").notNull(),
    subscriberKind: text("subscriber_kind", { enum: ["member", "agent"] }).notNull(),
    subscriberId: uuid("subscriber_id").notNull(),
    reason: text("reason", {
      enum: ["creator", "assignee", "commenter", "mentioned", "manual"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_issue_subscriber").on(t.issueId)],
);

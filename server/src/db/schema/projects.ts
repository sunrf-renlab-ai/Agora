import { index, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const projects = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    icon: text("icon"),
    priority: text("priority", { enum: ["urgent", "high", "medium", "low", "none"] })
      .notNull()
      .default("none"),
    leadType: text("lead_type", { enum: ["member", "agent"] }),
    leadId: uuid("lead_id"),
    status: text("status", {
      enum: ["planning", "active", "paused", "completed", "archived"],
    })
      .notNull()
      .default("active"),
    description: text("description"),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_project_workspace").on(t.workspaceId, t.status)],
);

export const projectResources = pgTable(
  "project_resource",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    resourceType: text("resource_type", { enum: ["repo", "url", "doc"] }).notNull(),
    resourceRef: text("resource_ref").notNull(),
    label: text("label"),
    position: real("position").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_project_resource_project").on(t.projectId, t.position),
    uniqueIndex("uq_project_resource_ref").on(t.projectId, t.resourceType, t.resourceRef),
  ],
);

import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { runtimes } from "./runtimes";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const skills = pgTable(
  "skill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    content: text("content").notNull().default(""),
    config: jsonb("config").notNull().default({}),
    visibility: text("visibility", { enum: ["workspace", "private", "public"] })
      .notNull()
      .default("workspace"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_skill_workspace_name").on(t.workspaceId, t.name),
    index("idx_skill_owner").on(t.ownerId),
  ],
);

export const skillFiles = pgTable(
  "skill_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_skill_file_path").on(t.skillId, t.path)],
);

export const agentSkills = pgTable(
  "agent_skill",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.skillId] })],
);

export const runtimeLocalSkillListRequests = pgTable(
  "runtime_local_skill_list_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runtimeId: uuid("runtime_id")
      .notNull()
      .references(() => runtimes.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "completed", "failed"] })
      .notNull()
      .default("pending"),
    skills: jsonb("skills").notNull().default([]),
    supported: boolean("supported").notNull().default(true),
    error: text("error").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_local_skill_list_runtime").on(t.runtimeId, t.status)],
);

export const runtimeLocalSkillImportRequests = pgTable(
  "runtime_local_skill_import_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runtimeId: uuid("runtime_id")
      .notNull()
      .references(() => runtimes.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillKey: text("skill_key").notNull(),
    skillId: uuid("skill_id").references(() => skills.id, { onDelete: "set null" }),
    status: text("status", { enum: ["pending", "completed", "failed"] })
      .notNull()
      .default("pending"),
    name: text("name").notNull().default(""),
    description: text("description").notNull().default(""),
    // Chosen visibility at promote-time. Stored on the request row so the
    // daemon callback can apply it atomically when it finalizes the
    // skill insert — no follow-up PATCH and no race with WS observers.
    visibility: text("visibility", { enum: ["workspace", "public"] })
      .notNull()
      .default("workspace"),
    error: text("error").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_local_skill_import_runtime").on(t.runtimeId, t.status)],
);

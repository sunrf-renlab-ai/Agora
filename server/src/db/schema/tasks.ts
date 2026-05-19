import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { issues } from "./issues";
import { runtimes } from "./runtimes";
import { workspaces } from "./workspaces";

export const agentTaskQueue = pgTable(
  "agent_task_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    runtimeId: uuid("runtime_id")
      .notNull()
      .references(() => runtimes.id),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "cascade" }),
    chatSessionId: uuid("chat_session_id"),
    autopilotRunId: uuid("autopilot_run_id"),
    status: text("status", {
      enum: ["queued", "dispatched", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    priority: integer("priority").notNull().default(0),
    triggerCommentId: uuid("trigger_comment_id"),
    triggerSummary: text("trigger_summary"),
    sessionId: text("session_id"),
    forceFreshSession: integer("force_fresh_session").notNull().default(0),
    workDir: text("work_dir"),
    originType: text("origin_type", { enum: ["autopilot", "quick_create"] }),
    originId: uuid("origin_id"),
    quickCreatePrompt: text("quick_create_prompt"),
    attempt: integer("attempt").notNull().default(1),
    maxAttempts: integer("max_attempts").notNull().default(2),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    parentTaskId: uuid("parent_task_id"),
    failureReason: text("failure_reason"),
    error: text("error"),
    errorKind: text("error_kind", {
      enum: [
        "prompt_render_error",
        "workspace_create_failed",
        "agent_spawn_failed",
        "turn_timeout",
        "stall_timeout",
        "agent_crashed",
        "tracker_error",
        "canceled_by_reconciliation",
        "runtime_recovery",
        "unknown",
      ],
    }),
    phase: text("phase", {
      enum: [
        "preparing_workspace",
        "building_prompt",
        "launching_agent",
        "streaming",
        "finishing",
        "done",
      ],
    }),
    usage: jsonb("usage"),
    result: jsonb("result"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_task_agent_status").on(t.agentId, t.status),
    index("idx_task_runtime_status").on(t.runtimeId, t.status),
    index("idx_task_claim_candidate").on(t.runtimeId, t.agentId, t.priority, t.createdAt),
    index("idx_task_next_attempt").on(t.status, t.nextAttemptAt),
  ],
);

// Per-task agent execution messages. Populated by the daemon as the agent CLI
// emits tool_use / tool_result / assistant text / stdout / stderr events; the
// web reads these to render a per-run execution timeline behind the "Expand"
// button in ExecutionLogSection. Seq is monotonically increasing per task so
// the daemon can resume after a flush failure idempotently (insert
// onConflictDoNothing on the (task_id, seq) unique index).
export const taskMessages = pgTable(
  "task_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => agentTaskQueue.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind", {
      enum: ["stdout", "stderr", "tool_use", "tool_result", "assistant", "system"],
    }).notNull(),
    // Shape depends on kind:
    //   stdout/stderr/assistant/system  → { text: string }
    //   tool_use                        → { name: string, input: unknown }
    //   tool_result                     → { name?: string, output: string }
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The unique index already serves both lookup and ordering on (task_id, seq);
  // a duplicate non-unique index would just double the write cost on the hot
  // daemon-flush insert path.
  (t) => [uniqueIndex("task_message_task_seq_unique").on(t.taskId, t.seq)],
);

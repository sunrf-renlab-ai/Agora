import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens"),
  description: z.string().max(500).optional(),
});

export const updateWorkspaceSchema = createWorkspaceSchema.partial();

export const createInvitationSchema = z.object({
  // Optional. Omit to generate a link-only invite — anyone with the URL
  // can accept. Provide an email to additionally surface this invitation
  // in that user's `/api/invitations` inbox when they sign in.
  email: z.string().email().optional(),
  role: z.enum(["admin", "member"]).default("member"),
});

export const updateMemberSchema = z.object({
  role: z.enum(["admin", "member"]),
});

// Issues
export const issueStatusEnum = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
]);

export const issuePriorityEnum = z.enum(["urgent", "high", "medium", "low", "none"]);

export const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  status: issueStatusEnum.default("backlog"),
  priority: issuePriorityEnum.default("none"),
  assigneeKind: z.enum(["member", "agent"]).optional(),
  assigneeId: z.string().uuid().optional(),
  // Free-form member/agent name resolved server-side via fuzzy match.
  // Ignored if `assigneeId` is also provided (explicit id wins). Lets the
  // CLI `--assignee <name>` / `--to <name>` flags skip a client-side
  // workspace roster lookup.
  assigneeName: z.string().min(1).optional(),
  parentIssueId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
  // Origin tracking — only honored when the request is authed by a task
  // JWT (CLI invocations spawned by the daemon). Lets the completion
  // handler look up the issue an agent just created via origin_id =
  // task.id.
  originType: z.enum(["autopilot", "quick_create"]).optional(),
  originId: z.string().uuid().optional(),
});

// Manual approach (not .partial()) because update allows clearing nullable fields
// that don't exist in create (e.g. nullable assigneeId, dueDate).
export const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  status: issueStatusEnum.optional(),
  priority: issuePriorityEnum.optional(),
  assigneeKind: z.enum(["member", "agent"]).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  // See createIssueSchema.assigneeName. Ignored when assigneeId is provided.
  // Cannot clear an assignee (use assigneeId=null for that).
  assigneeName: z.string().min(1).optional(),
  parentIssueId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

export const batchUpdateIssuesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  status: issueStatusEnum.optional(),
  priority: issuePriorityEnum.optional(),
  assigneeKind: z.enum(["member", "agent"]).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
});

export const batchDeleteIssuesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export const searchIssuesSchema = z.object({
  q: z.string().min(1).max(200),
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export const escalateIssueSchema = z.object({
  reason: z.string().min(1).max(2000),
});

// Comments
export const createCommentSchema = z.object({
  content: z.string().min(1).max(50000),
  parentCommentId: z.string().uuid().optional(),
});

export const updateCommentSchema = z.object({
  content: z.string().min(1).max(50000),
});

export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional().default(""),
  instructions: z.string().max(20000).optional().default(""),
  visibility: z.enum(["workspace", "private"]).default("private"),
  runtimeId: z.string().uuid().nullable().optional(),
  cliKind: z.enum(["claude_code", "codex", "gemini", "openclaw", "hermes"]).default("claude_code"),
  runtimeConfig: z.record(z.unknown()).default({}),
  model: z.string().nullable().optional(),
  customEnv: z.record(z.string()).default({}),
  customArgs: z.array(z.string()).default([]),
  mcpConfig: z.record(z.unknown()).default({}),
  maxConcurrentTasks: z.number().int().min(1).max(10).default(1),
});

export const updateAgentSchema = createAgentSchema.partial();

export const archiveAgentSchema = z.object({});

export const quickCreateIssueSchema = z.object({
  agentId: z.string().uuid(),
  prompt: z.string().min(1).max(8000),
});

export const cancelTaskSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const detectedCliSchema = z.object({
  kind: z.string().min(1),
  version: z.string().default(""),
});

export const daemonRegisterRequestSchema = z.object({
  name: z.string().min(1).max(100),
  daemonVersion: z.string().min(1).max(50),
  detectedClis: z.array(detectedCliSchema).min(1),
  runtimeInfo: z.record(z.unknown()).default({}),
});

export const daemonHeartbeatRequestSchema = z.object({
  detectedClis: z.array(detectedCliSchema).optional(),
});

export const daemonClaimRequestSchema = z.object({});

export const daemonStartTaskSchema = z.object({
  sessionId: z.string().max(500).nullable().optional(),
  workDir: z.string().max(4096).nullable().optional(),
});

export const runUsageSchema = z
  .object({
    inputTokens: z.number().nullable().optional(),
    outputTokens: z.number().nullable().optional(),
    cacheReadTokens: z.number().nullable().optional(),
    cacheCreationTokens: z.number().nullable().optional(),
    totalCostUsd: z.number().nullable().optional(),
    durationMs: z.number().nullable().optional(),
    numTurns: z.number().nullable().optional(),
    model: z.string().nullable().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

export const daemonCompleteTaskSchema = z.object({
  result: z
    .object({
      reply: z.string().max(200000).optional(),
      exitCode: z.number().int().optional(),
    })
    .passthrough()
    .optional()
    .default({}),
  sessionId: z.string().max(500).nullable().optional(),
  workDir: z.string().max(4096).nullable().optional(),
  usage: runUsageSchema,
});

export const daemonFailTaskSchema = z.object({
  error: z.string().max(2000),
  failureReason: z
    .enum([
      "agent_error",
      "runtime_error",
      "runtime_offline",
      "iteration_limit",
      "agent_fallback_message",
      "runtime_recovery",
    ])
    .optional(),
  errorKind: z
    .enum([
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
    ])
    .optional(),
  sessionId: z.string().max(500).nullable().optional(),
  workDir: z.string().max(4096).nullable().optional(),
  usage: runUsageSchema,
});

// Per-task agent execution message kinds. Mirrors the enum on the
// task_message table column.
export const taskMessageKindSchema = z.enum([
  "stdout",
  "stderr",
  "tool_use",
  "tool_result",
  "assistant",
  "system",
]);

// One message in a daemon batch. seq is monotonically increasing per task so
// the server can dedupe retries via onConflictDoNothing on (task_id, seq).
export const daemonTaskMessageSchema = z.object({
  seq: z.number().int().nonnegative(),
  kind: taskMessageKindSchema,
  content: z.unknown(),
});

export const daemonTaskMessagesBatchSchema = z.object({
  messages: z.array(daemonTaskMessageSchema).min(1).max(500),
});

export const createAutopilotSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  assigneeId: z.string().uuid(),
  executionMode: z.enum(["create_issue", "run_only"]).default("create_issue"),
  issueTitleTemplate: z.string().max(200).nullable().optional(),
});

export const updateAutopilotSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  assigneeId: z.string().uuid().optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  executionMode: z.enum(["create_issue", "run_only"]).optional(),
  issueTitleTemplate: z.string().max(200).nullable().optional(),
});

export const createAutopilotTriggerSchema = z
  .object({
    kind: z.enum(["schedule", "webhook", "api"]),
    enabled: z.boolean().default(true),
    cronExpression: z.string().max(200).nullable().optional(),
    timezone: z.string().max(100).default("UTC"),
    label: z.string().max(200).nullable().optional(),
  })
  .refine(
    (v) => v.kind !== "schedule" || (v.cronExpression && v.cronExpression.trim().length > 0),
    { message: "schedule trigger requires cronExpression" },
  );

export const updateAutopilotTriggerSchema = z.object({
  enabled: z.boolean().optional(),
  cronExpression: z.string().max(200).nullable().optional(),
  timezone: z.string().max(100).optional(),
  label: z.string().max(200).nullable().optional(),
});

export const manualTriggerAutopilotSchema = z.object({
  payload: z.unknown().optional(),
});

export const createChatSessionSchema = z.object({
  agentId: z.string().uuid(),
  title: z.string().max(200).optional().default(""),
});

export const updateChatSessionSchema = z.object({
  title: z.string().min(1).max(200),
});

export const sendChatMessageSchema = z.object({
  content: z.string().min(1).max(50000),
});

export const createProjectSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  color: z.string().max(60).nullable().optional(),
  status: z.enum(["planning", "active", "paused", "completed", "archived"]).optional(),
  priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
  leadType: z.enum(["member", "agent"]).nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const addProjectResourceSchema = z.object({
  resourceType: z.enum(["repo", "url", "doc"]),
  resourceRef: z.string().min(1).max(2000),
  label: z.string().max(200).nullable().optional(),
  position: z.number().int().nonnegative().optional(),
});

const skillFileInputSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(1_000_000).default(""),
});

export const createSkillSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  content: z.string().max(1_000_000).default(""),
  config: z.record(z.unknown()).default({}),
  visibility: z.enum(["workspace", "private", "public"]).optional(),
  files: z.array(skillFileInputSchema).max(128).default([]),
});

export const updateSkillSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  content: z.string().max(1_000_000).optional(),
  config: z.record(z.unknown()).optional(),
  visibility: z.enum(["workspace", "private", "public"]).optional(),
  files: z.array(skillFileInputSchema).max(128).optional(),
});

export const setAgentSkillsSchema = z.object({
  skillIds: z.array(z.string().uuid()).max(64),
});

export const importSkillUrlSchema = z.object({
  url: z.string().min(1).max(2000),
});

export const createLocalSkillImportSchema = z.object({
  skillKey: z.string().min(1).max(500),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  visibility: z.enum(["workspace", "public"]).optional(),
});

// ---------- Phase 7: labels ----------
const hexColorRE = /^#[0-9a-fA-F]{6}$/;
export const createLabelSchema = z.object({
  name: z.string().min(1).max(32),
  color: z.string().regex(hexColorRE, "Color must be a 6-digit hex like #3b82f6"),
});
export const updateLabelSchema = createLabelSchema.partial();
export const assignLabelSchema = z.object({ labelId: z.string().uuid() });

// ---------- Phase 7: dependencies ----------
// Single-direction storage rule: only 'blocks' or 'related' may be inserted.
// 'blocked_by' is the inverse view computed at query time.
export const createDependencySchema = z.object({
  dependsOnIssueId: z.string().uuid(),
  type: z.enum(["blocks", "related"]),
});

// ---------- Phase 7: reactions ----------
export const addReactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});

// ---------- Phase 7: attachments ----------
const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024; // 100 MB
export const signAttachmentUploadSchema = z.object({
  ownerKind: z.enum(["issue", "comment", "chat_message"]),
  ownerId: z.string().uuid(),
  filename: z.string().min(1).max(256),
  contentType: z.string().min(1).max(128),
  size: z.number().int().positive().max(MAX_ATTACHMENT_SIZE),
});
export const createAttachmentSchema = signAttachmentUploadSchema.extend({
  storageKey: z.string().min(1).max(512),
});

// ---------- Phase 7: pins ----------
export const createPinSchema = z.object({
  itemType: z.enum(["issue", "project", "agent"]),
  itemId: z.string().uuid(),
});

// ---------- Subscribers (issue subscribe/unsubscribe) ----------
// Both fields are optional, but the route handler enforces all-or-nothing:
// either provide both subscriberKind+subscriberId (subscribe a specific
// entity) or neither (defaults to the caller). Providing exactly one of the
// two is rejected with 400 — there's no useful interpretation of e.g. a kind
// without an id.
export const subscribeRequestSchema = z.object({
  subscriberKind: z.enum(["member", "agent"]).optional(),
  subscriberId: z.string().uuid().optional(),
});

// ---------- Phase 8: notification preferences ----------
const notificationGroupSchema = z.object({ enabled: z.boolean() });

export const updateNotificationPreferencesSchema = z.object({
  assignments: notificationGroupSchema.optional(),
  status_changes: notificationGroupSchema.optional(),
  comments: notificationGroupSchema.optional(),
  updates: notificationGroupSchema.optional(),
  agent_activity: notificationGroupSchema.optional(),
});

// ---------- Phase 8: feedback ----------
export const submitFeedbackSchema = z.object({
  content: z.string().min(1).max(20000),
  kind: z.enum(["general", "bug", "feature"]).default("general"),
  workspaceId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});

// ---------- Phase 8: personal access tokens ----------
export const createPatSchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().nullable().optional(),
});

// ---------- Knowledge Base ----------
const knowledgeKindSchema = z.enum(["general", "faq", "decision", "runbook", "onboarding"]);

export const createKnowledgeDocSchema = z.object({
  kind: knowledgeKindSchema.default("general"),
  title: z.string().min(1).max(200),
  content: z.string().max(200_000).default(""),
  /** Optional project scope. Null/absent = workspace-wide. */
  projectId: z.string().uuid().nullable().optional(),
});

export const updateKnowledgeDocSchema = z
  .object({
    kind: knowledgeKindSchema.optional(),
    title: z.string().min(1).max(200).optional(),
    content: z.string().max(200_000).optional(),
    projectId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "no fields to update" });

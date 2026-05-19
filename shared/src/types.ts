export const CLI_KINDS = [
  "claude_code",
  "codex",
  "gemini",
  "openclaw",
  "hermes",
] as const;

export type CliKind = (typeof CLI_KINDS)[number];

/** Human label shown in the agent form / settings UI. */
export const CLI_LABELS: Record<CliKind, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  openclaw: "OpenClaw",
  hermes: "Hermes",
};

/** One-line install hint surfaced on the connections page. */
export const CLI_INSTALL_HINTS: Record<CliKind, string> = {
  claude_code: "npm i -g @anthropic-ai/claude-code",
  codex: "npm i -g @openai/codex",
  gemini: "npm i -g @google/gemini-cli",
  openclaw: "brew install openclaw  (or pip install openclaw)",
  hermes: "pip install hermes-acp  (or brew install hermes)",
};

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  onboardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  issuePrefix: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type MemberRole = "owner" | "admin" | "member";

export interface Member {
  id: string;
  workspaceId: string;
  userId: string;
  role: MemberRole;
  user: User;
  createdAt: string;
}

export interface MemberInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: Exclude<MemberRole, "owner">;
  token: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export type IssueStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked"
  | "cancelled";

export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

export type ActorKind = "member" | "agent";

/**
 * Lightweight assignee/creator shape returned by the issues API.
 * Unifies User and Agent so the UI does not need to branch on
 * `assigneeKind`/`creatorKind` to render a name + avatar.
 * `email` is null for agents.
 */
export interface IssueActor {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface Issue {
  id: string;
  workspaceId: string;
  number: number;
  identifier: string; // e.g. "AGR-1"
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeKind: ActorKind | null;
  assigneeId: string | null;
  /**
   * Resolved assignee (member User or Agent) — null when unassigned or when
   * the referenced row is missing. Use `assigneeKind` to disambiguate.
   */
  assignee: IssueActor | null;
  creatorKind: ActorKind;
  creatorId: string;
  /**
   * Resolved creator (member User or Agent) — null only if the referenced
   * row is missing. Use `creatorKind` to disambiguate.
   */
  creator: IssueActor | null;
  parentIssueId: string | null;
  projectId: string | null;
  position: number;
  dueDate: string | null;
  /** Eagerly loaded by GET /issues and GET /issues/:id (Phase 10). Empty array when none. */
  labels?: Label[];
  createdAt: string;
  updatedAt: string;
}

export type CommentType = "comment" | "status_change" | "progress_update" | "system";

export interface Comment {
  id: string;
  issueId: string;
  authorKind: ActorKind;
  authorId: string;
  author: User | null;
  content: string;
  type: CommentType;
  parentCommentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssueSubscriber {
  id: string;
  issueId: string;
  subscriberKind: ActorKind;
  subscriberId: string;
  reason: "creator" | "assignee" | "commenter" | "mentioned" | "manual";
  createdAt: string;
}

export type InboxSeverity = "action_required" | "attention" | "info";

export interface InboxItem {
  id: string;
  workspaceId: string;
  recipientKind: ActorKind;
  recipientId: string;
  type: string; // e.g. "issue_comment" | "issue_status_changed" | "issue_assigned"
  severity: InboxSeverity;
  issueId: string | null;
  title: string;
  body: string | null;
  read: boolean;
  archived: boolean;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  workspaceId: string;
  issueId: string | null;
  actorKind: ActorKind | null;
  actorId: string | null;
  actor: User | null;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface IssueSearchResult {
  id: string;
  identifier: string;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  snippet: string | null;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export type AgentVisibility = "workspace" | "private";

export interface DetectedCli {
  kind: string;
  version: string;
}

export interface Agent {
  id: string;
  workspaceId: string;
  ownerId: string | null;
  name: string;
  description: string;
  instructions: string;
  avatarUrl: string | null;
  visibility: AgentVisibility;
  runtimeId: string | null;
  cliKind: CliKind;
  runtimeConfig: Record<string, unknown>;
  model: string | null;
  customEnv: Record<string, string>;
  customArgs: string[];
  mcpConfig: Record<string, unknown>;
  maxConcurrentTasks: number;
  archivedAt: string | null;
  archivedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Runtime {
  id: string;
  workspaceId: string;
  memberId: string;
  name: string;
  daemonVersion: string;
  detectedClis: DetectedCli[];
  online: boolean;
  lastHeartbeatAt: string | null;
  runtimeInfo: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = "queued" | "dispatched" | "running" | "completed" | "failed" | "cancelled";

export interface AgentTask {
  id: string;
  workspaceId: string;
  agentId: string;
  runtimeId: string;
  issueId: string | null;
  status: TaskStatus;
  priority: number;
  triggerCommentId: string | null;
  triggerSummary: string | null;
  sessionId: string | null;
  workDir: string | null;
  originType: "autopilot" | "quick_create" | null;
  originId: string | null;
  quickCreatePrompt: string | null;
  attempt: number;
  maxAttempts: number;
  parentTaskId: string | null;
  failureReason: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  /**
   * Token + cost usage extracted from the CLI tail. Populated by the
   * daemon on task completion. Shape is loose because each CLI emits
   * different keys; the web reads `inputTokens`, `outputTokens`,
   * `cacheTokens` when present (see web/src/components/issues/usage.ts).
   */
  usage: Record<string, unknown> | null;
  dispatchedAt: string | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  completedAt: string | null;
  chatSessionId: string | null;
  autopilotRunId: string | null;
  forceFreshSession: number;
  createdAt: string;
  updatedAt: string;
}

export interface MentionRef {
  kind: "member" | "agent" | "issue" | "all";
  id: string;
}

// One persisted per-task agent execution message. The web fetches a list
// of these (paginated by seq) to render the execution timeline behind the
// expand button on AgentRunCard.
export type TaskMessageKind =
  | "stdout"
  | "stderr"
  | "tool_use"
  | "tool_result"
  | "assistant"
  | "system";

export interface TaskMessage {
  id: string;
  taskId: string;
  workspaceId: string;
  seq: number;
  kind: TaskMessageKind;
  // Shape depends on kind — see server/src/db/schema/tasks.ts for details.
  content: unknown;
  createdAt: string;
}

export type AutopilotStatus = "active" | "paused" | "archived";
export type AutopilotExecutionMode = "create_issue" | "run_only";
export type TriggerKind = "schedule" | "webhook" | "api";
export type AutopilotRunStatus = "issue_created" | "running" | "completed" | "failed";
export type AutopilotRunSource = "schedule" | "manual" | "webhook" | "api";

export interface Autopilot {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  assigneeId: string;
  status: AutopilotStatus;
  executionMode: AutopilotExecutionMode;
  issueTitleTemplate: string | null;
  createdByKind: "member" | "agent";
  createdById: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutopilotTrigger {
  id: string;
  autopilotId: string;
  kind: TriggerKind;
  enabled: boolean;
  cronExpression: string | null;
  timezone: string | null;
  nextRunAt: string | null;
  /** sha256 hash; cleartext webhook token is shown ONCE on creation */
  webhookTokenHash: string | null;
  label: string | null;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ChatRole = "user" | "assistant";
export type ChatSessionStatus = "active" | "archived";

export interface ChatSession {
  id: string;
  workspaceId: string;
  agentId: string;
  creatorId: string;
  runtimeId: string | null;
  title: string;
  sessionId: string | null;
  workDir: string | null;
  status: ChatSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  chatSessionId: string;
  role: ChatRole;
  content: string;
  taskId: string | null;
  failureReason: string | null;
  elapsedMs: number | null;
  createdAt: string;
}

export interface AutopilotRun {
  id: string;
  autopilotId: string;
  triggerId: string | null;
  source: AutopilotRunSource;
  status: AutopilotRunStatus;
  issueId: string | null;
  taskId: string | null;
  triggeredAt: string;
  completedAt: string | null;
  failureReason: string | null;
  triggerPayload: unknown;
  result: unknown;
  createdAt: string;
}

export type ProjectStatus = "planning" | "active" | "paused" | "completed" | "archived";

export interface Project {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  status: ProjectStatus;
  priority: IssuePriority;
  leadType: ActorKind | null;
  leadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectResourceType = "repo" | "url" | "doc";

export interface ProjectResource {
  id: string;
  projectId: string;
  workspaceId: string;
  resourceType: ProjectResourceType;
  resourceRef: string;
  label: string | null;
  position: number;
  createdBy: string | null;
  createdAt: string;
}

export type SkillVisibility = "workspace" | "private" | "public";

export interface Skill {
  id: string;
  workspaceId: string;
  ownerId: string | null;
  name: string;
  description: string;
  content: string;
  config: Record<string, unknown>;
  visibility: SkillVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface SkillFile {
  id: string;
  skillId: string;
  path: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillWithFiles extends Skill {
  files: SkillFile[];
}

export interface AgentSkillBinding {
  agentId: string;
  skillId: string;
  createdAt: string;
}

export interface RuntimeLocalSkillSummary {
  key: string;
  name: string;
  description: string;
  sourcePath: string;
  provider: string;
  fileCount: number;
}

export type RuntimeLocalSkillRequestStatus = "pending" | "completed" | "failed";

export interface RuntimeLocalSkillListRequest {
  id: string;
  runtimeId: string;
  status: RuntimeLocalSkillRequestStatus;
  skills: RuntimeLocalSkillSummary[];
  supported: boolean;
  error: string;
  createdAt: string;
}

export interface RuntimeLocalSkillImportRequest {
  id: string;
  runtimeId: string;
  creatorId: string;
  skillKey: string;
  name: string;
  description: string;
  status: RuntimeLocalSkillRequestStatus;
  skillId: string | null;
  error: string;
  createdAt: string;
}

// ---------- Phase 7: labels / dependencies / reactions / attachments / pins ----------

export interface Label {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueDependency {
  id: string;
  workspaceId: string;
  issueId: string;
  dependsOnIssueId: string;
  type: "blocks" | "related";
  createdByUserId: string | null;
  createdAt: string;
}

/** Returned by GET /issues/:id/dependencies — server computes both sides. */
export interface IssueDependencyView {
  blocks: IssueDependency[];
  blockedBy: IssueDependency[];
  related: IssueDependency[];
}

export interface Reaction {
  id: string;
  workspaceId: string;
  targetKind: "issue" | "comment";
  targetId: string;
  actorKind: ActorKind;
  actorId: string;
  emoji: string;
  createdAt: string;
}

export type AttachmentOwnerKind = "issue" | "comment" | "chat_message";

export interface Attachment {
  id: string;
  workspaceId: string;
  ownerKind: AttachmentOwnerKind;
  ownerId: string;
  filename: string;
  contentType: string;
  size: number;
  storageKey: string;
  createdByUserId: string | null;
  createdAt: string;
}

export interface AttachmentSignedUpload {
  storageKey: string;
  uploadUrl: string;
  token: string;
}

export type PinItemType = "issue" | "project" | "agent";

export interface Pin {
  id: string;
  workspaceId: string;
  userId: string;
  itemType: PinItemType;
  itemId: string;
  position: number;
  createdAt: string;
}

export interface NotificationPreferenceGroup {
  enabled: boolean;
}

export interface NotificationPreferences {
  assignments: NotificationPreferenceGroup;
  status_changes: NotificationPreferenceGroup;
  comments: NotificationPreferenceGroup;
  updates: NotificationPreferenceGroup;
  agent_activity: NotificationPreferenceGroup;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  assignments: { enabled: true },
  status_changes: { enabled: true },
  comments: { enabled: true },
  updates: { enabled: true },
  agent_activity: { enabled: true },
};

export type FeedbackKind = "general" | "bug" | "feature";

export interface Feedback {
  id: string;
  userId: string;
  workspaceId: string | null;
  kind: FeedbackKind;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PersonalAccessToken {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  revoked: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface PersonalAccessTokenWithCleartext extends PersonalAccessToken {
  /** Cleartext returned ONLY on creation. Never persisted, never re-shown. */
  token: string;
}

// ─── Knowledge Base ─────────────────────────────────────────────────

export type KnowledgeKind = "general" | "faq" | "decision" | "runbook" | "onboarding";
export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = [
  "general",
  "faq",
  "decision",
  "runbook",
  "onboarding",
] as const;

export interface KnowledgeDoc {
  id: string;
  workspaceId: string;
  /** NULL = workspace-wide; set = scoped to that project. */
  projectId: string | null;
  kind: KnowledgeKind;
  title: string;
  content: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ConnectionKind = "linear" | "github" | "notion" | "slack";
export const CONNECTION_KINDS: readonly ConnectionKind[] = [
  "linear",
  "github",
  "notion",
  "slack",
] as const;
export type ConnectionStatus = "pending" | "connected" | "revoked";

export interface UserConnection {
  kind: ConnectionKind;
  status: ConnectionStatus;
  connectedAt: string | null;
}

import { relations } from "drizzle-orm";
import {
  activityLog,
  agentSkills,
  agentTaskQueue,
  agents,
  attachments,
  autopilotRuns,
  autopilotTriggers,
  autopilots,
  chatMessages,
  chatSessions,
  commentReactions,
  comments,
  inboxItems,
  issueDependencies,
  issueLabels,
  issueReactions,
  issueSubscribers,
  issueToLabel,
  issues,
  memberInvitations,
  members,
  pins,
  projectResources,
  projects,
  runtimeLocalSkillImportRequests,
  runtimeLocalSkillListRequests,
  runtimes,
  skillFiles,
  skills,
  users,
  workspaces,
} from "./index";

export const usersRelations = relations(users, ({ many }) => ({
  members: many(members),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(members),
  invitations: many(memberInvitations),
  issues: many(issues),
}));

export const membersRelations = relations(members, ({ one }) => ({
  user: one(users, { fields: [members.userId], references: [users.id] }),
  workspace: one(workspaces, { fields: [members.workspaceId], references: [workspaces.id] }),
}));

export const memberInvitationsRelations = relations(memberInvitations, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [memberInvitations.workspaceId],
    references: [workspaces.id],
  }),
}));

export const issuesRelations = relations(issues, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [issues.workspaceId], references: [workspaces.id] }),
  comments: many(comments),
  subscribers: many(issueSubscribers),
  activityLogs: many(activityLog),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  issue: one(issues, { fields: [comments.issueId], references: [issues.id] }),
}));

export const issueSubscribersRelations = relations(issueSubscribers, ({ one }) => ({
  issue: one(issues, { fields: [issueSubscribers.issueId], references: [issues.id] }),
}));

export const inboxItemsRelations = relations(inboxItems, ({ one }) => ({
  workspace: one(workspaces, { fields: [inboxItems.workspaceId], references: [workspaces.id] }),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  issue: one(issues, { fields: [activityLog.issueId], references: [issues.id] }),
}));

export const runtimesRelations = relations(runtimes, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [runtimes.workspaceId], references: [workspaces.id] }),
  member: one(members, { fields: [runtimes.memberId], references: [members.id] }),
  agents: many(agents),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [agents.workspaceId], references: [workspaces.id] }),
  owner: one(users, { fields: [agents.ownerId], references: [users.id] }),
  runtime: one(runtimes, { fields: [agents.runtimeId], references: [runtimes.id] }),
  tasks: many(agentTaskQueue),
}));

export const tasksRelations = relations(agentTaskQueue, ({ one }) => ({
  workspace: one(workspaces, { fields: [agentTaskQueue.workspaceId], references: [workspaces.id] }),
  agent: one(agents, { fields: [agentTaskQueue.agentId], references: [agents.id] }),
  runtime: one(runtimes, { fields: [agentTaskQueue.runtimeId], references: [runtimes.id] }),
  issue: one(issues, { fields: [agentTaskQueue.issueId], references: [issues.id] }),
}));

export const autopilotsRelations = relations(autopilots, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [autopilots.workspaceId], references: [workspaces.id] }),
  assignee: one(agents, { fields: [autopilots.assigneeId], references: [agents.id] }),
  triggers: many(autopilotTriggers),
  runs: many(autopilotRuns),
}));

export const autopilotTriggersRelations = relations(autopilotTriggers, ({ one }) => ({
  autopilot: one(autopilots, {
    fields: [autopilotTriggers.autopilotId],
    references: [autopilots.id],
  }),
}));

export const autopilotRunsRelations = relations(autopilotRuns, ({ one }) => ({
  autopilot: one(autopilots, { fields: [autopilotRuns.autopilotId], references: [autopilots.id] }),
  trigger: one(autopilotTriggers, {
    fields: [autopilotRuns.triggerId],
    references: [autopilotTriggers.id],
  }),
  issue: one(issues, { fields: [autopilotRuns.issueId], references: [issues.id] }),
  task: one(agentTaskQueue, { fields: [autopilotRuns.taskId], references: [agentTaskQueue.id] }),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [chatSessions.workspaceId], references: [workspaces.id] }),
  agent: one(agents, { fields: [chatSessions.agentId], references: [agents.id] }),
  creator: one(users, { fields: [chatSessions.creatorId], references: [users.id] }),
  runtime: one(runtimes, { fields: [chatSessions.runtimeId], references: [runtimes.id] }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.chatSessionId],
    references: [chatSessions.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  resources: many(projectResources),
}));

export const projectResourcesRelations = relations(projectResources, ({ one }) => ({
  project: one(projects, { fields: [projectResources.projectId], references: [projects.id] }),
  workspace: one(workspaces, {
    fields: [projectResources.workspaceId],
    references: [workspaces.id],
  }),
  creator: one(users, { fields: [projectResources.createdBy], references: [users.id] }),
}));

export const skillsRelations = relations(skills, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [skills.workspaceId], references: [workspaces.id] }),
  owner: one(users, { fields: [skills.ownerId], references: [users.id] }),
  files: many(skillFiles),
  agents: many(agentSkills),
}));

export const skillFilesRelations = relations(skillFiles, ({ one }) => ({
  skill: one(skills, { fields: [skillFiles.skillId], references: [skills.id] }),
}));

export const agentSkillsRelations = relations(agentSkills, ({ one }) => ({
  agent: one(agents, { fields: [agentSkills.agentId], references: [agents.id] }),
  skill: one(skills, { fields: [agentSkills.skillId], references: [skills.id] }),
}));

export const runtimeLocalSkillListRequestsRelations = relations(
  runtimeLocalSkillListRequests,
  ({ one }) => ({
    runtime: one(runtimes, {
      fields: [runtimeLocalSkillListRequests.runtimeId],
      references: [runtimes.id],
    }),
    creator: one(users, {
      fields: [runtimeLocalSkillListRequests.creatorId],
      references: [users.id],
    }),
  }),
);

export const runtimeLocalSkillImportRequestsRelations = relations(
  runtimeLocalSkillImportRequests,
  ({ one }) => ({
    runtime: one(runtimes, {
      fields: [runtimeLocalSkillImportRequests.runtimeId],
      references: [runtimes.id],
    }),
    creator: one(users, {
      fields: [runtimeLocalSkillImportRequests.creatorId],
      references: [users.id],
    }),
    skill: one(skills, {
      fields: [runtimeLocalSkillImportRequests.skillId],
      references: [skills.id],
    }),
  }),
);

export const issueLabelsRelations = relations(issueLabels, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [issueLabels.workspaceId], references: [workspaces.id] }),
  assignments: many(issueToLabel),
}));

export const issueToLabelRelations = relations(issueToLabel, ({ one }) => ({
  issue: one(issues, { fields: [issueToLabel.issueId], references: [issues.id] }),
  label: one(issueLabels, { fields: [issueToLabel.labelId], references: [issueLabels.id] }),
}));

export const issueDependenciesRelations = relations(issueDependencies, ({ one }) => ({
  issue: one(issues, { fields: [issueDependencies.issueId], references: [issues.id] }),
  target: one(issues, {
    fields: [issueDependencies.dependsOnIssueId],
    references: [issues.id],
    relationName: "dependency_target",
  }),
}));

export const commentReactionsRelations = relations(commentReactions, ({ one }) => ({
  comment: one(comments, { fields: [commentReactions.commentId], references: [comments.id] }),
}));

export const issueReactionsRelations = relations(issueReactions, ({ one }) => ({
  issue: one(issues, { fields: [issueReactions.issueId], references: [issues.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  workspace: one(workspaces, { fields: [attachments.workspaceId], references: [workspaces.id] }),
}));

export const pinsRelations = relations(pins, ({ one }) => ({
  workspace: one(workspaces, { fields: [pins.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [pins.userId], references: [users.id] }),
}));

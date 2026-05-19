import type { RuntimeLocalSkillRequestStatus } from "./types";

export type WSEvent =
  | { type: "workspace.updated"; data: { id: string } }
  | { type: "member.created"; data: { workspaceId: string; userId: string } }
  | { type: "member.removed"; data: { workspaceId: string; userId: string } }
  | { type: "issue.created"; data: { id: string; workspaceId: string } }
  | { type: "issue.updated"; data: { id: string; workspaceId: string } }
  | { type: "issue.deleted"; data: { id: string; workspaceId: string } }
  | { type: "comment.created"; data: { id: string; issueId: string } }
  | {
      type: "task.queued";
      data: {
        id: string;
        agentId: string;
        runtimeId: string;
        issueId: string | null;
        workspaceId: string;
      };
    }
  | { type: "task.dispatched"; data: { id: string; agentId: string; runtimeId: string } }
  | { type: "task.started"; data: { id: string; agentId: string } }
  | { type: "task.completed"; data: { id: string; issueId: string | null } }
  | {
      type: "task.failed";
      data: { id: string; issueId: string | null; reason: string };
    }
  | { type: "task.cancelled"; data: { id: string } }
  | {
      type: "task.messages_appended";
      data: { id: string; workspaceId: string; latestSeq: number };
    }
  | { type: "agent.created"; data: { id: string; workspaceId: string } }
  | { type: "agent.updated"; data: { id: string; workspaceId: string } }
  | { type: "agent.archived"; data: { id: string; workspaceId: string } }
  | { type: "runtime.online"; data: { id: string; workspaceId: string } }
  | { type: "runtime.offline"; data: { id: string; workspaceId: string } }
  | { type: "inbox.created"; data: { id: string; recipientId: string } }
  | { type: "chat.message_added"; data: { sessionId: string } }
  | { type: "chat.session_created"; data: { id: string; workspaceId: string } }
  | { type: "chat.session_updated"; data: { id: string; workspaceId: string } }
  | { type: "chat.session_deleted"; data: { id: string; workspaceId: string } }
  | { type: "autopilot.created"; data: { id: string; workspaceId: string } }
  | { type: "autopilot.updated"; data: { id: string; workspaceId: string } }
  | { type: "autopilot.deleted"; data: { id: string; workspaceId: string } }
  | {
      type: "autopilot.run.start";
      data: { autopilotId: string; runId: string; workspaceId: string };
    }
  | {
      type: "autopilot.run.done";
      data: {
        autopilotId: string;
        runId: string;
        status: "completed" | "failed";
        workspaceId: string;
      };
    }
  | { type: "project.created"; data: { id: string; workspaceId: string } }
  | { type: "project.updated"; data: { id: string; workspaceId: string } }
  | { type: "project.deleted"; data: { id: string; workspaceId: string } }
  | { type: "skill.created"; data: { id: string; workspaceId: string } }
  | { type: "skill.updated"; data: { id: string; workspaceId: string } }
  | { type: "skill.deleted"; data: { id: string; workspaceId: string } }
  | { type: "knowledge.created"; data: { id: string } }
  | { type: "knowledge.updated"; data: { id: string } }
  | { type: "knowledge.deleted"; data: { id: string } }
  | { type: "agent.skills_changed"; data: { agentId: string; workspaceId: string } }
  | {
      type: "runtime.local_skills.list_updated";
      data: { runtimeId: string; requestId: string; status: RuntimeLocalSkillRequestStatus };
    }
  | {
      type: "runtime.local_skills.import_updated";
      data: { runtimeId: string; requestId: string; status: RuntimeLocalSkillRequestStatus };
    }
  | { type: "label.created"; data: { id: string; workspaceId: string } }
  | { type: "label.updated"; data: { id: string; workspaceId: string } }
  | { type: "label.deleted"; data: { id: string; workspaceId: string } }
  | { type: "issue.labels_changed"; data: { issueId: string; workspaceId: string } }
  | { type: "issue.dependencies_changed"; data: { issueId: string; workspaceId: string } }
  | {
      type: "reaction.added";
      data: {
        targetKind: "issue" | "comment";
        targetId: string;
        emoji: string;
        workspaceId: string;
      };
    }
  | {
      type: "reaction.removed";
      data: {
        targetKind: "issue" | "comment";
        targetId: string;
        emoji: string;
        workspaceId: string;
      };
    }
  | {
      type: "attachment.added";
      data: {
        id: string;
        ownerKind: "issue" | "comment" | "chat_message";
        ownerId: string;
        workspaceId: string;
      };
    }
  | {
      type: "attachment.removed";
      data: {
        id: string;
        ownerKind: "issue" | "comment" | "chat_message";
        ownerId: string;
        workspaceId: string;
      };
    }
  | { type: "pin.created"; data: { id: string; userId: string; workspaceId: string } }
  | { type: "pin.deleted"; data: { id: string; userId: string; workspaceId: string } }
  | {
      type: "presence.changed";
      data: {
        issueId: string;
        workspaceId: string;
        viewers: Array<{ userId: string; name: string | null; avatarUrl: string | null }>;
      };
    };

export interface WSMessage {
  event: WSEvent;
  workspaceId: string;
}

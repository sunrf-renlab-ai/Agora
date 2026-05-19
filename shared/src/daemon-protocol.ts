import { z } from "zod";

// WS frames flowing daemon ↔ server.

export const daemonHelloSchema = z.object({
  type: z.literal("hello"),
  runtimeId: z.string().uuid(),
  daemonVersion: z.string(),
});

export const daemonHeartbeatFrameSchema = z.object({
  type: z.literal("heartbeat"),
  runtimeId: z.string().uuid(),
});

export const taskAvailableFrameSchema = z.object({
  type: z.literal("task.available"),
  runtimeId: z.string().uuid(),
  taskId: z.string().uuid(),
});

export const ackFrameSchema = z.object({
  type: z.literal("ack"),
  ts: z.string().datetime(),
});

export const daemonFrameSchema = z.discriminatedUnion("type", [
  daemonHelloSchema,
  daemonHeartbeatFrameSchema,
  taskAvailableFrameSchema,
  ackFrameSchema,
]);

export type DaemonHello = z.infer<typeof daemonHelloSchema>;
export type DaemonHeartbeatFrame = z.infer<typeof daemonHeartbeatFrameSchema>;
export type TaskAvailableFrame = z.infer<typeof taskAvailableFrameSchema>;
export type AckFrame = z.infer<typeof ackFrameSchema>;
export type DaemonFrame = z.infer<typeof daemonFrameSchema>;

export interface SkillSyncFile {
  path: string;
  content: string;
}

export interface SkillSyncBundle {
  skillId: string;
  name: string;
  description: string;
  content: string;
  files: SkillSyncFile[];
}

export interface SkillSyncFrame {
  type: "skill.sync";
  runtimeId: string;
  // Full set of skills the runtime should have on disk after applying.
  // Daemon prunes any skill folder under ~/.claude/skills/ owned by Agora
  // that isn't in this set.
  bundles: SkillSyncBundle[];
  // Names that should be deleted (sent when an agent_skill row was removed
  // and no other agent on this runtime references that skill).
  removeNames: string[];
}

export interface SkillDiscoverFrame {
  type: "skill.discover";
  runtimeId: string;
  requestId: string;
  kind: "list" | "import";
  // Only set when kind === "import": the skill key the daemon should bundle
  // and POST back as a single skill_file array.
  skillKey?: string;
}

export interface LocalSkillReportSummary {
  key: string;
  name: string;
  description: string;
  sourcePath: string;
  provider: string;
  fileCount: number;
}

export interface LocalSkillReportListBody {
  status: "completed" | "failed";
  skills?: LocalSkillReportSummary[];
  supported?: boolean;
  error?: string;
}

export interface LocalSkillReportImportBody {
  status: "completed" | "failed";
  skill?: {
    name: string;
    description: string;
    content: string;
    sourcePath: string;
    provider: string;
    files: { path: string; content: string }[];
  };
  error?: string;
}

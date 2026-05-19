import { db } from "../db/client";
import { activityLog } from "../db/schema/index";

export async function logActivity(
  workspaceId: string,
  actorKind: "member" | "agent" | "system" | null,
  actorId: string | null,
  action: string,
  details: Record<string, unknown> = {},
  issueId?: string,
) {
  await db.insert(activityLog).values({
    workspaceId,
    issueId: issueId ?? null,
    actorKind,
    actorId,
    action,
    details,
  });
}

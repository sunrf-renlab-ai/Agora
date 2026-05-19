import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { inboxItems, issueSubscribers } from "../db/schema/index";
import { hub } from "./ws-hub";

export async function ensureSubscribed(
  issueId: string,
  subscriberKind: "member" | "agent",
  subscriberId: string,
  reason: "creator" | "assignee" | "commenter" | "mentioned" | "manual",
) {
  await db
    .insert(issueSubscribers)
    .values({ issueId, subscriberKind, subscriberId, reason })
    .onConflictDoNothing();
}

export async function notifySubscribers(
  workspaceId: string,
  issueId: string,
  actorId: string,
  type: string,
  title: string,
  body: string | null,
) {
  const subs = await db.query.issueSubscribers.findMany({
    where: eq(issueSubscribers.issueId, issueId),
  });

  const recipients = subs.filter(
    (s) => s.subscriberKind === "member" && s.subscriberId !== actorId,
  );
  if (recipients.length === 0) return;

  const rows = recipients.map((s) => ({
    workspaceId,
    recipientKind: "member" as const,
    recipientId: s.subscriberId,
    type,
    issueId,
    title,
    body,
  }));

  const created = await db.insert(inboxItems).values(rows).returning();

  for (const item of created) {
    hub.broadcast(`workspace:${workspaceId}`, {
      type: "inbox.created",
      data: { id: item.id, recipientId: item.recipientId },
    });
  }
}

export async function extractMentionedUserIds(
  _workspaceId: string,
  content: string,
): Promise<string[]> {
  const mentionPattern = /@([a-zA-Z0-9._-]+)/g;
  const handles: string[] = [];
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop
  while ((match = mentionPattern.exec(content)) !== null) {
    handles.push(match[1] as string);
  }
  // @mention resolution requires a handle column not yet implemented
  if (handles.length === 0) return [];
  return [];
}

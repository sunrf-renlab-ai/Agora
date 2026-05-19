import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { inboxItems, issueSubscribers, members, userConnections } from "../db/schema/index";
import { postSlackMessage } from "./slack";
import { decryptToken } from "./token-crypto";
import { hub } from "./ws-hub";

type Severity = "action_required" | "attention" | "info";

interface NotifyIssueHumansOpts {
  workspaceId: string;
  issueId: string;
  type: string;
  severity: Severity;
  title: string;
  body: string | null;
  /** User id to exclude from recipients — e.g. the human who triggered
   *  the escalation themselves. Optional. */
  excludeUserId?: string;
}

/**
 * Deliver an inbox item to the humans who should know about something
 * happening on an issue — escalations, terminal task failures.
 *
 * Recipient set is the union of:
 *  - workspace owners + admins (role-based; guaranteed real humans, and
 *    every workspace has at least one owner — this is the backbone that
 *    makes delivery reliable even for orchestrator-filed sub-issues that
 *    have no human subscribers)
 *  - the issue's member-kind subscribers (creator / assignee / commenter
 *    / manual — these resolve to real users)
 *
 * Deduped by user id. Each recipient gets one `inbox_item` row and an
 * `inbox.created` WS event.
 */
export async function notifyIssueHumans(opts: NotifyIssueHumansOpts): Promise<void> {
  const { workspaceId, issueId, type, severity, title, body, excludeUserId } = opts;

  const [admins, subs] = await Promise.all([
    db
      .select({ userId: members.userId })
      .from(members)
      .where(and(eq(members.workspaceId, workspaceId), inArray(members.role, ["owner", "admin"]))),
    db.query.issueSubscribers.findMany({ where: eq(issueSubscribers.issueId, issueId) }),
  ]);

  const recipientIds = new Set<string>();
  for (const a of admins) recipientIds.add(a.userId);
  for (const s of subs) {
    if (s.subscriberKind === "member") recipientIds.add(s.subscriberId);
  }
  if (excludeUserId) recipientIds.delete(excludeUserId);
  if (recipientIds.size === 0) return;

  const rows = Array.from(recipientIds, (recipientId) => ({
    workspaceId,
    recipientKind: "member" as const,
    recipientId,
    type,
    severity,
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

  // Mirror the notification to Slack for any recipient who connected it.
  await deliverSlackDMs(Array.from(recipientIds), title, body);
}

/**
 * Best-effort: DM every recipient who has a connected Slack connection.
 * Each post is isolated — a Slack outage or a bad token must not break
 * the inbox path that already succeeded above.
 */
async function deliverSlackDMs(
  recipientIds: string[],
  title: string,
  body: string | null,
): Promise<void> {
  if (recipientIds.length === 0) return;
  const conns = await db.query.userConnections.findMany({
    where: and(
      inArray(userConnections.userId, recipientIds),
      eq(userConnections.kind, "slack"),
      eq(userConnections.status, "connected"),
    ),
  });
  if (conns.length === 0) return;

  const text = body ? `*${title}*\n${body}` : title;
  await Promise.allSettled(
    conns.map(async (conn) => {
      const cfg = conn.config as { access_token?: string; account_id?: string } | null;
      if (!cfg?.access_token || !cfg.account_id) return;
      let botToken: string;
      try {
        botToken = decryptToken(cfg.access_token);
      } catch {
        return; // rotated key / tampered row — skip this one
      }
      await postSlackMessage(botToken, cfg.account_id, text);
    }),
  );
}

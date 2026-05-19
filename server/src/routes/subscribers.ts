import { subscribeRequestSchema } from "@agora/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { agents, issueSubscribers, issues, members } from "../db/schema/index";
import { badRequest, forbidden, jsonError, notFound } from "../lib/errors";
import { ensureSubscribed } from "../lib/subscribe";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

// Resolve the (kind, id) the request wants to subscribe/unsubscribe.
//
// Returns:
//  - { ok: true, target: { kind, id }, isSelf } when the body is valid
//    (either both fields present and the entity exists in this workspace,
//    or both fields absent → defaults to the caller).
//  - { ok: false, status, message } for 400 (partial body) / 404 (entity
//    missing in this workspace).
//
// Self-target is computed against the caller's user id; agent targets are
// never "self" for a human-authed request.
async function resolveTarget(
  body: { subscriberKind?: "member" | "agent"; subscriberId?: string },
  workspaceId: string,
  callerUserId: string,
): Promise<
  | { ok: true; target: { kind: "member" | "agent"; id: string }; isSelf: boolean }
  | { ok: false; status: 400 | 404; message: string }
> {
  const { subscriberKind, subscriberId } = body;

  // No body → caller subscribes themselves. This is the legacy path the CLI
  // hits when no --user/--user-id flag is given.
  if (!subscriberKind && !subscriberId) {
    return { ok: true, target: { kind: "member", id: callerUserId }, isSelf: true };
  }

  // Exactly one provided — ambiguous, reject with a precise message instead
  // of silently picking a default.
  if (!subscriberKind || !subscriberId) {
    return {
      ok: false,
      status: 400,
      message: "subscriberKind and subscriberId must be provided together",
    };
  }

  // Verify the entity exists in this workspace before inserting. Without this
  // a caller could plant arbitrary UUIDs in the subscribers table.
  if (subscriberKind === "member") {
    // members.userId is the FK to users.id, so the wire's subscriberId
    // (which is a user id, per the CLI) is matched against members.userId.
    const m = await db.query.members.findFirst({
      where: and(eq(members.workspaceId, workspaceId), eq(members.userId, subscriberId)),
    });
    if (!m) return { ok: false, status: 404, message: "Member not found in workspace" };
  } else {
    const a = await db.query.agents.findFirst({
      where: and(eq(agents.workspaceId, workspaceId), eq(agents.id, subscriberId)),
    });
    if (!a) return { ok: false, status: 404, message: "Agent not found in workspace" };
  }

  const isSelf = subscriberKind === "member" && subscriberId === callerUserId;
  return { ok: true, target: { kind: subscriberKind, id: subscriberId }, isSelf };
}

// GET /api/workspaces/:workspaceId/issues/:issueId/subscribers
app.get("/api/workspaces/:workspaceId/issues/:issueId/subscribers", async (c) => {
  const workspaceId = c.get("workspaceId");
  const issueId = c.req.param("issueId");

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const subs = await db.query.issueSubscribers.findMany({
    where: eq(issueSubscribers.issueId, issueId),
  });
  return c.json(
    subs.map((s) => ({
      id: s.id,
      issueId: s.issueId,
      subscriberKind: s.subscriberKind,
      subscriberId: s.subscriberId,
      reason: s.reason,
      createdAt: s.createdAt.toISOString(),
    })),
  );
});

// POST /api/workspaces/:workspaceId/issues/:issueId/subscribers
//
// Body (zod-validated): { subscriberKind?, subscriberId? }
//  - both absent → subscribe the caller (default)
//  - both present → subscribe that specific entity (requires owner/admin
//    when the target isn't the caller themselves)
//  - exactly one present → 400
app.post("/api/workspaces/:workspaceId/issues/:issueId/subscribers", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const issueId = c.req.param("issueId");

  // Body is optional — older clients (and the CLI without flags) send no body
  // at all. Treat both missing and malformed-JSON-but-no-content as empty so
  // we don't 400 the self-subscribe path.
  let parsedBody: { subscriberKind?: "member" | "agent"; subscriberId?: string } = {};
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      const raw = await c.req.json();
      const parsed = subscribeRequestSchema.safeParse(raw);
      if (!parsed.success) return badRequest(c, parsed.error.message);
      parsedBody = parsed.data;
    } catch {
      // empty / invalid JSON → fall through to self-subscribe
    }
  }

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const resolved = await resolveTarget(parsedBody, workspaceId, user.id);
  if (!resolved.ok) {
    if (resolved.status === 404) return notFound(c, resolved.message.replace(/ not found.*/, ""));
    return badRequest(c, resolved.message);
  }

  // Subscribing another entity (anyone but the caller themselves) requires
  // elevated role. Plain members can only subscribe themselves.
  if (!resolved.isSelf && role !== "owner" && role !== "admin") {
    return forbidden(c);
  }

  await ensureSubscribed(issueId, resolved.target.kind, resolved.target.id, "manual");
  return c.json({ subscribed: true });
});

// DELETE /api/workspaces/:workspaceId/issues/:issueId/subscribers
//
// Same body shape and authorization rules as POST. Empty body → unsubscribe
// the caller.
app.delete("/api/workspaces/:workspaceId/issues/:issueId/subscribers", async (c) => {
  const workspaceId = c.get("workspaceId");
  const user = c.get("user");
  const role = c.get("memberRole");
  const issueId = c.req.param("issueId");

  let parsedBody: { subscriberKind?: "member" | "agent"; subscriberId?: string } = {};
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      const raw = await c.req.json();
      const parsed = subscribeRequestSchema.safeParse(raw);
      if (!parsed.success) return badRequest(c, parsed.error.message);
      parsedBody = parsed.data;
    } catch {
      // empty / invalid JSON → fall through to self-unsubscribe
    }
  }

  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)),
  });
  if (!issue) return notFound(c, "Issue");

  const resolved = await resolveTarget(parsedBody, workspaceId, user.id);
  if (!resolved.ok) {
    if (resolved.status === 404) return notFound(c, resolved.message.replace(/ not found.*/, ""));
    return badRequest(c, resolved.message);
  }

  if (!resolved.isSelf && role !== "owner" && role !== "admin") {
    return forbidden(c);
  }

  // .returning() so we can honor rowsAffected — distinguishing "row existed
  // and was deleted" from "no-op, nothing to delete". The legacy
  // `{subscribed:false}` lie made the UI think it had unsubscribed even when
  // the subscription never existed, which masked stale local state bugs.
  const deleted = await db
    .delete(issueSubscribers)
    .where(
      and(
        eq(issueSubscribers.issueId, issueId),
        eq(issueSubscribers.subscriberKind, resolved.target.kind),
        eq(issueSubscribers.subscriberId, resolved.target.id),
      ),
    )
    .returning({ id: issueSubscribers.id });

  if (deleted.length === 0) return jsonError(c, 404, "Not subscribed");
  // 204 No Content — DELETE on a row resource where the client just needs
  // to know it succeeded. No envelope, no body to parse.
  return c.body(null, 204);
});

export default app;

import { and, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { memberInvitations, members, workspaces } from "../db/schema/index";
import { jsonError, notFound } from "../lib/errors";
import { hub } from "../lib/ws-hub";
import { authMiddleware, requireUser } from "../middleware/auth";

// An invitation is dead when it has expired. Email-bound invitations are
// additionally single-use — once that one recipient accepts or declines,
// the invite is spent. Link-only invitations (email IS NULL) have no
// per-person state: anyone with the URL can accept until it expires.
function invitationIsDead(inv: typeof memberInvitations.$inferSelect): boolean {
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) return true;
  if (inv.email && (inv.acceptedAt || inv.declinedAt)) return true;
  return false;
}

const app = new Hono();
app.use(authMiddleware);
app.use(requireUser);

app.get("/api/invitations", async (c) => {
  const user = c.get("user");
  const invs = await db.query.memberInvitations.findMany({
    where: and(
      eq(memberInvitations.email, user.email),
      isNull(memberInvitations.acceptedAt),
      isNull(memberInvitations.declinedAt),
    ),
  });
  // Bulk-load workspace names so the inbox / first-login picker can render
  // "Join Acme Inc." instead of opaque UUIDs without N+1 round-trips.
  const wsIds = Array.from(new Set(invs.map((i) => i.workspaceId)));
  const wsRows =
    wsIds.length > 0
      ? await db.query.workspaces.findMany({ where: inArray(workspaces.id, wsIds) })
      : [];
  const wsName = new Map(wsRows.map((w) => [w.id, w.name]));
  return c.json(
    invs.map((inv) => ({
      id: inv.id,
      workspaceId: inv.workspaceId,
      workspaceName: wsName.get(inv.workspaceId) ?? null,
      email: inv.email,
      role: inv.role,
      token: inv.token,
      createdAt: inv.createdAt.toISOString(),
    })),
  );
});

app.get("/api/invitations/:token", async (c) => {
  const token = c.req.param("token");
  const inv = await db.query.memberInvitations.findFirst({
    where: eq(memberInvitations.token, token),
  });
  if (!inv) return notFound(c, "Invitation");
  // A dead invite (expired, or a spent email-bound invite) is reported as
  // 404 so the invite page shows "not found or expired" instead of a live
  // Accept button that would just fail.
  if (invitationIsDead(inv)) return notFound(c, "Invitation");

  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, inv.workspaceId) });
  return c.json({
    id: inv.id,
    workspaceId: inv.workspaceId,
    workspaceName: ws?.name,
    email: inv.email,
    role: inv.role,
    token: inv.token,
    createdAt: inv.createdAt.toISOString(),
  });
});

app.post("/api/invitations/:token/accept", async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");

  // Look up by token alone, then branch on the invitation kind. The old
  // code filtered `acceptedAt IS NULL`, which made even link-only invites
  // single-use — the first acceptor stamped `acceptedAt` on the shared
  // row and everyone after them 404'd.
  const inv = await db.query.memberInvitations.findFirst({
    where: eq(memberInvitations.token, token),
  });
  if (!inv) return notFound(c, "Invitation");
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) {
    return jsonError(c, 410, "This invitation link has expired");
  }
  if (inv.email && (inv.acceptedAt || inv.declinedAt)) {
    return jsonError(c, 410, "This invitation has already been used");
  }

  await db
    .insert(members)
    .values({
      workspaceId: inv.workspaceId,
      userId: user.id,
      role: inv.role,
    })
    .onConflictDoNothing();

  // Only email-bound invitations are single-use — stamp `acceptedAt` to
  // spend them. Link-only invitations stay reusable until they expire, so
  // we deliberately leave their `acceptedAt` null.
  if (inv.email) {
    await db
      .update(memberInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(memberInvitations.id, inv.id));
  }

  hub.broadcast(`workspace:${inv.workspaceId}`, {
    type: "member.created",
    data: { workspaceId: inv.workspaceId, userId: user.id },
  });

  return c.json({ workspaceId: inv.workspaceId });
});

app.post("/api/invitations/:token/decline", async (c) => {
  const token = c.req.param("token");
  const inv = await db.query.memberInvitations.findFirst({
    where: eq(memberInvitations.token, token),
  });
  if (!inv) return notFound(c, "Invitation");

  // Only email-bound invitations carry per-person decline state. Declining
  // a link-only invite must NOT stamp the shared row — other people still
  // need the link to work.
  if (inv.email && !inv.declinedAt) {
    await db
      .update(memberInvitations)
      .set({ declinedAt: new Date() })
      .where(eq(memberInvitations.id, inv.id));
  }

  return c.body(null, 204);
});

export default app;

import { randomBytes } from "node:crypto";
import { createInvitationSchema, updateMemberSchema } from "@agora/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { memberInvitations, members } from "../db/schema/index";
import { forbidden, jsonError, notFound } from "../lib/errors";
import { hub } from "../lib/ws-hub";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";

const app = new Hono();
app.use(authMiddleware);
app.use(workspaceMiddleware);

function memberToJson(m: any) {
  return {
    id: m.id,
    workspaceId: m.workspaceId,
    userId: m.userId,
    role: m.role,
    user: m.user
      ? { id: m.user.id, name: m.user.name, email: m.user.email, avatarUrl: m.user.avatarUrl }
      : null,
    createdAt: m.createdAt.toISOString(),
  };
}

app.get("/api/workspaces/:workspaceId/members", async (c) => {
  const workspaceId = c.get("workspaceId");
  const rows = await db.query.members.findMany({
    where: eq(members.workspaceId, workspaceId),
    with: { user: true } as any,
  });
  return c.json(rows.map(memberToJson));
});

app.post("/api/workspaces/:workspaceId/members", async (c) => {
  const role = c.get("memberRole");
  if (role === "member") return forbidden(c);

  const workspaceId = c.get("workspaceId");
  const body = await c.req.json();
  const parsed = createInvitationSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const user = c.get("user");
  const token = randomBytes(32).toString("hex");

  // Email is optional. When omitted we mint a link-only invite — the URL
  // is the credential, anyone holding it can accept. When provided we
  // additionally make the invite show up in that user's
  // /api/invitations inbox via the email-match query in invitations.ts.
  const [inv] = await db
    .insert(memberInvitations)
    .values({
      workspaceId,
      email: parsed.data.email ?? null,
      role: parsed.data.role,
      invitedByUserId: user.id,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning();

  if (!inv) return jsonError(c, 500, "Failed to create invitation");
  return c.json(
    {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      token: inv.token,
      inviteUrl: `${process.env.FRONTEND_ORIGIN}/invite/${inv.token}`,
      createdAt: inv.createdAt.toISOString(),
    },
    201,
  );
});

app.patch("/api/workspaces/:workspaceId/members/:memberId", async (c) => {
  const role = c.get("memberRole");
  if (role === "member") return forbidden(c);

  const workspaceId = c.get("workspaceId");
  const memberId = c.req.param("memberId");
  const body = await c.req.json();
  const parsed = updateMemberSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 400, parsed.error.message);

  const [updated] = await db
    .update(members)
    .set({ role: parsed.data.role })
    .where(and(eq(members.id, memberId), eq(members.workspaceId, workspaceId)))
    .returning();
  if (!updated) return notFound(c, "Member");

  return c.json(memberToJson({ ...updated, user: null }));
});

app.delete("/api/workspaces/:workspaceId/members/:memberId", async (c) => {
  const role = c.get("memberRole");
  if (role === "member") return forbidden(c);

  const workspaceId = c.get("workspaceId");
  const memberId = c.req.param("memberId");

  const target = await db.query.members.findFirst({
    where: and(eq(members.id, memberId), eq(members.workspaceId, workspaceId)),
  });
  if (!target) return notFound(c, "Member");
  if (target.role === "owner") return forbidden(c);

  await db.delete(members).where(eq(members.id, memberId));

  hub.broadcast(`workspace:${workspaceId}`, {
    type: "member.removed",
    data: { workspaceId, userId: target.userId },
  });
  return c.body(null, 204);
});

export default app;

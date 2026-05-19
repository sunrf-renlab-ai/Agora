import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { memberInvitations, members, personalAccessTokens, users, workspaces } from "../db/schema/index";
import { generatePat } from "../lib/pat-token";
import { createApp } from "./index";

// Invitations are one of two kinds:
//  - link-only  (email IS NULL)  — reusable; anyone with the URL joins
//  - email-bound (email set)     — single-use for that one recipient
//
// The accept handler used to filter `acceptedAt IS NULL` and stamp
// `acceptedAt` on accept, which made even link-only invites single-use:
// the second person to click Accept 404'd. These tests pin the fixed
// behaviour.

describe("POST /api/invitations/:token/accept", () => {
  let workspaceId: string;
  let inviterId: string;
  let userAId: string;
  let userBId: string;
  let patA: string;
  let patB: string;

  async function makeUser(label: string): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({ email: `${label}-${Date.now()}-${randomBytes(3).toString("hex")}@x`, name: label })
      .returning();
    return u!.id;
  }

  async function makePat(userId: string): Promise<string> {
    const pat = generatePat();
    await db.insert(personalAccessTokens).values({
      userId,
      name: "test",
      tokenHash: pat.hash,
      tokenPrefix: pat.prefix,
    });
    return pat.token;
  }

  function makeInvite(opts: {
    email?: string | null;
    expiresAt?: Date | null;
    acceptedAt?: Date | null;
    declinedAt?: Date | null;
  }) {
    const token = randomBytes(16).toString("hex");
    return db
      .insert(memberInvitations)
      .values({
        workspaceId,
        email: opts.email ?? null,
        role: "member",
        invitedByUserId: inviterId,
        token,
        expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        acceptedAt: opts.acceptedAt ?? null,
        declinedAt: opts.declinedAt ?? null,
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  function accept(token: string, pat: string) {
    return createApp().request(`/api/invitations/${token}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}` },
    });
  }

  function decline(token: string, pat: string) {
    return createApp().request(`/api/invitations/${token}/decline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}` },
    });
  }

  function getInvite(token: string, pat: string) {
    return createApp().request(`/api/invitations/${token}`, {
      headers: { Authorization: `Bearer ${pat}` },
    });
  }

  async function isMember(userId: string): Promise<boolean> {
    const rows = await db
      .select()
      .from(members)
      .where(sql`workspace_id = ${workspaceId} AND user_id = ${userId}`);
    return rows.length > 0;
  }

  beforeEach(async () => {
    const stamp = `${Date.now()}-${randomBytes(3).toString("hex")}`;
    const [w] = await db
      .insert(workspaces)
      .values({ name: "Inv", slug: `inv-${stamp}`, issuePrefix: "INV" })
      .returning();
    workspaceId = w!.id;
    inviterId = await makeUser("inviter");
    userAId = await makeUser("user-a");
    userBId = await makeUser("user-b");
    patA = await makePat(userAId);
    patB = await makePat(userBId);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${inviterId}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userAId}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userBId}`);
  });

  test("link-only invite: two different people can both accept", async () => {
    const inv = await makeInvite({ email: null });

    const resA = await accept(inv.token, patA);
    expect(resA.status).toBe(200);
    expect(await isMember(userAId)).toBe(true);

    // The bug: this second accept used to 404. It must now succeed.
    const resB = await accept(inv.token, patB);
    expect(resB.status).toBe(200);
    expect(await isMember(userBId)).toBe(true);
  });

  test("link-only invite is not consumed — acceptedAt stays null", async () => {
    const inv = await makeInvite({ email: null });
    await accept(inv.token, patA);
    const [row] = await db
      .select()
      .from(memberInvitations)
      .where(sql`id = ${inv.id}`);
    expect(row!.acceptedAt).toBeNull();
  });

  test("email-bound invite is single-use: second person gets 410", async () => {
    const inv = await makeInvite({ email: "someone@x" });

    const resA = await accept(inv.token, patA);
    expect(resA.status).toBe(200);

    const resB = await accept(inv.token, patB);
    expect(resB.status).toBe(410);
    expect(await isMember(userBId)).toBe(false);
  });

  test("expired invite is rejected with 410", async () => {
    const inv = await makeInvite({ email: null, expiresAt: new Date(Date.now() - 1000) });
    const res = await accept(inv.token, patA);
    expect(res.status).toBe(410);
    expect(await isMember(userAId)).toBe(false);
  });

  test("declining a link-only invite does not kill the link for others", async () => {
    const inv = await makeInvite({ email: null });

    const declineRes = await decline(inv.token, patA);
    expect(declineRes.status).toBe(204);

    // User B must still be able to accept — decline must not stamp the
    // shared link-only row.
    const resB = await accept(inv.token, patB);
    expect(resB.status).toBe(200);
    expect(await isMember(userBId)).toBe(true);
  });

  test("unknown token → 404", async () => {
    const res = await accept(randomBytes(16).toString("hex"), patA);
    expect(res.status).toBe(404);
  });

  test("GET on an expired invite → 404", async () => {
    const inv = await makeInvite({ email: null, expiresAt: new Date(Date.now() - 1000) });
    const res = await getInvite(inv.token, patA);
    expect(res.status).toBe(404);
  });
});

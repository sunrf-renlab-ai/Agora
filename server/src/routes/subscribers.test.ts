import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agents,
  issueSubscribers,
  issues,
  members,
  personalAccessTokens,
  users,
  workspaces,
} from "../db/schema/index";
import { generatePat } from "../lib/pat-token";
import subscribersRouter from "./subscribers";

// Shared fixture: workspace with an owner, a plain member, and an agent. Each
// test seeds a fresh issue. PATs let us hit the auth-protected endpoints as
// either user without faking middleware.
let workspaceId: string;
let ownerUserId: string;
let memberUserId: string;
let agentId: string;
let issueId: string;
let ownerToken: string;
let memberToken: string;

beforeEach(async () => {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const [owner] = await db
    .insert(users)
    .values({ email: `sub-owner-${stamp}@x`, name: "Owner" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  ownerUserId = owner!.id;
  const [memberUser] = await db
    .insert(users)
    .values({ email: `sub-member-${stamp}@x`, name: "Member" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  memberUserId = memberUser!.id;

  const [ws] = await db
    .insert(workspaces)
    .values({ name: "S", slug: `s-${stamp}`, issuePrefix: "S" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  workspaceId = ws!.id;

  await db.insert(members).values([
    { workspaceId, userId: ownerUserId, role: "owner" },
    { workspaceId, userId: memberUserId, role: "member" },
  ]);

  const [agent] = await db
    .insert(agents)
    .values({ workspaceId, name: "Agnes", cliKind: "claude_code" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  agentId = agent!.id;

  const [issue] = await db
    .insert(issues)
    .values({ workspaceId, number: 1, title: "I", creatorKind: "member", creatorId: ownerUserId })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  issueId = issue!.id;

  const ownerPat = generatePat();
  await db.insert(personalAccessTokens).values({
    userId: ownerUserId,
    name: "test",
    tokenHash: ownerPat.hash,
    tokenPrefix: ownerPat.prefix,
  });
  ownerToken = ownerPat.token;

  const memberPat = generatePat();
  await db.insert(personalAccessTokens).values({
    userId: memberUserId,
    name: "test",
    tokenHash: memberPat.hash,
    tokenPrefix: memberPat.prefix,
  });
  memberToken = memberPat.token;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${ownerUserId}, ${memberUserId})`);
});

// Wrapper around router.request that injects the auth + workspace headers
// every endpoint requires. Lets each test focus on body / response.
function post(token: string, body?: unknown) {
  return subscribersRouter.request(`/api/workspaces/${workspaceId}/issues/${issueId}/subscribers`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Workspace-ID": workspaceId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function del(token: string, body?: unknown) {
  return subscribersRouter.request(`/api/workspaces/${workspaceId}/issues/${issueId}/subscribers`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Workspace-ID": workspaceId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("subscribers routes", () => {
  it("self-subscribe with no body works", async () => {
    const res = await post(ownerToken);
    expect(res.status).toBe(200);

    const rows = await db.query.issueSubscribers.findMany({
      where: sql`issue_id = ${issueId}`,
    });
    expect(rows.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: length check above
    expect(rows[0]!.subscriberKind).toBe("member");
    // biome-ignore lint/style/noNonNullAssertion: length check above
    expect(rows[0]!.subscriberId).toBe(ownerUserId);
  });

  it("owner subscribes another member", async () => {
    const res = await post(ownerToken, {
      subscriberKind: "member",
      subscriberId: memberUserId,
    });
    expect(res.status).toBe(200);

    const row = await db.query.issueSubscribers.findFirst({
      where: sql`issue_id = ${issueId} AND subscriber_id = ${memberUserId}`,
    });
    expect(row?.subscriberKind).toBe("member");
  });

  it("owner subscribes an agent", async () => {
    const res = await post(ownerToken, {
      subscriberKind: "agent",
      subscriberId: agentId,
    });
    expect(res.status).toBe(200);

    const row = await db.query.issueSubscribers.findFirst({
      where: sql`issue_id = ${issueId} AND subscriber_id = ${agentId}`,
    });
    expect(row?.subscriberKind).toBe("agent");
  });

  it("member subscribes themselves explicitly (not 'others')", async () => {
    const res = await post(memberToken, {
      subscriberKind: "member",
      subscriberId: memberUserId,
    });
    expect(res.status).toBe(200);
  });

  it("member trying to subscribe another member → 403", async () => {
    const res = await post(memberToken, {
      subscriberKind: "member",
      subscriberId: ownerUserId,
    });
    expect(res.status).toBe(403);
  });

  it("subscribe non-existent member → 404", async () => {
    const res = await post(ownerToken, {
      subscriberKind: "member",
      subscriberId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(404);
  });

  it("subscribe non-existent agent → 404", async () => {
    const res = await post(ownerToken, {
      subscriberKind: "agent",
      subscriberId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(404);
  });

  it("only subscriberKind without subscriberId → 400", async () => {
    const res = await post(ownerToken, { subscriberKind: "member" });
    expect(res.status).toBe(400);
  });

  it("only subscriberId without subscriberKind → 400", async () => {
    const res = await post(ownerToken, { subscriberId: ownerUserId });
    expect(res.status).toBe(400);
  });

  it("invalid subscriberKind → 400 (zod)", async () => {
    const res = await post(ownerToken, {
      subscriberKind: "robot",
      subscriberId: ownerUserId,
    });
    expect(res.status).toBe(400);
  });

  it("DELETE with no body unsubscribes caller (204)", async () => {
    await db
      .insert(issueSubscribers)
      .values({ issueId, subscriberKind: "member", subscriberId: memberUserId, reason: "manual" });

    const res = await del(memberToken);
    // 204 No Content — DELETE on an existing row succeeds without a body.
    expect(res.status).toBe(204);

    const rows = await db.query.issueSubscribers.findMany({
      where: sql`issue_id = ${issueId}`,
    });
    expect(rows.length).toBe(0);
  });

  it("owner can unsubscribe another member (204)", async () => {
    await db
      .insert(issueSubscribers)
      .values({ issueId, subscriberKind: "member", subscriberId: memberUserId, reason: "manual" });

    const res = await del(ownerToken, {
      subscriberKind: "member",
      subscriberId: memberUserId,
    });
    expect(res.status).toBe(204);

    const rows = await db.query.issueSubscribers.findMany({
      where: sql`issue_id = ${issueId}`,
    });
    expect(rows.length).toBe(0);
  });

  it("member cannot unsubscribe another member → 403", async () => {
    await db
      .insert(issueSubscribers)
      .values({ issueId, subscriberKind: "member", subscriberId: ownerUserId, reason: "manual" });

    const res = await del(memberToken, {
      subscriberKind: "member",
      subscriberId: ownerUserId,
    });
    expect(res.status).toBe(403);
  });

  // The handler now honors rowsAffected: 204 No Content on success, 404 with
  // `{error:"Not subscribed"}` when nothing matched. This distinguishes
  // "row existed and was deleted" from "no-op" so the UI never thinks it
  // unsubscribed from a row that never existed.
  it("DELETE returns 204 (no body) when row existed", async () => {
    await db
      .insert(issueSubscribers)
      .values({ issueId, subscriberKind: "member", subscriberId: ownerUserId, reason: "manual" });

    const res = await del(ownerToken);
    expect(res.status).toBe(204);
    // 204 must not carry a body. Reading it should yield empty text.
    const text = await res.text();
    expect(text).toBe("");

    const rows = await db.query.issueSubscribers.findMany({
      where: sql`issue_id = ${issueId}`,
    });
    expect(rows.length).toBe(0);
  });

  it("DELETE returns 404 {error:'Not subscribed'} when row did NOT exist", async () => {
    // No insert — caller isn't subscribed.
    const res = await del(ownerToken);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not subscribed");
  });
});

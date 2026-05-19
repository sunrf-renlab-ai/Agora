import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { issueReactions, issues, members, users, workspaces } from "../db/schema/index";
import reactionsRouter from "./reactions";

let workspaceId: string;
let userId: string;
let issueId: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `r-${Date.now()}@x`, name: "R" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "R", slug: `r-${Date.now()}`, issuePrefix: "R" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  workspaceId = w!.id;
  await db.insert(members).values({ workspaceId, userId, role: "owner" });
  const [i] = await db
    .insert(issues)
    .values({ workspaceId, number: 1, title: "I", creatorKind: "member", creatorId: userId })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  issueId = i!.id;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("reactions routes", () => {
  it("requires auth on add", async () => {
    const res = await reactionsRouter.request(
      `/api/workspaces/${workspaceId}/issues/${issueId}/reactions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji: "👍" }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("DB layer: same (issue, actor, emoji) is unique", async () => {
    await db.insert(issueReactions).values({
      workspaceId,
      issueId,
      actorKind: "member",
      actorId: userId,
      emoji: "👍",
    });
    let threw = false;
    try {
      await db.insert(issueReactions).values({
        workspaceId,
        issueId,
        actorKind: "member",
        actorId: userId,
        emoji: "👍",
      });
    } catch (e) {
      threw = true;
      const msg = `${String(e)} ${String((e as { cause?: unknown }).cause ?? "")}`;
      expect(msg).toContain("uq_issue_reaction");
    }
    expect(threw).toBe(true);
  });
});

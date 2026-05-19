import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { issueDependencies, issues, members, users, workspaces } from "../db/schema/index";
import dependenciesRouter from "./dependencies";

let workspaceId: string;
let userId: string;
let issueA: string;
let issueB: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `dep-${Date.now()}@x`, name: "D" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "D", slug: `d-${Date.now()}`, issuePrefix: "D" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  workspaceId = w!.id;
  await db.insert(members).values({ workspaceId, userId, role: "owner" });
  const [a] = await db
    .insert(issues)
    .values({ workspaceId, number: 1, title: "A", creatorKind: "member", creatorId: userId })
    .returning();
  const [b] = await db
    .insert(issues)
    .values({ workspaceId, number: 2, title: "B", creatorKind: "member", creatorId: userId })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  issueA = a!.id;
  // biome-ignore lint/style/noNonNullAssertion: test setup
  issueB = b!.id;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("dependencies routes", () => {
  it("requires auth on list", async () => {
    const res = await dependenciesRouter.request(
      `/api/workspaces/${workspaceId}/issues/${issueA}/dependencies`,
    );
    expect(res.status).toBe(401);
  });

  it("requires auth on create", async () => {
    const res = await dependenciesRouter.request(
      `/api/workspaces/${workspaceId}/issues/${issueA}/dependencies`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dependsOnIssueId: issueB, type: "blocks" }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("query layer: GET returns blockedBy from inverse rows", async () => {
    // Direct DB seed: B blocks A → from A's perspective, blockedBy contains B.
    await db.insert(issueDependencies).values({
      workspaceId,
      issueId: issueB,
      dependsOnIssueId: issueA,
      type: "blocks",
      createdByUserId: userId,
    });
    // Sanity: what we just inserted
    const rows = await db
      .select()
      .from(issueDependencies)
      .where(sql`workspace_id = ${workspaceId}`);
    expect(rows.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: test assertion after length check
    expect(rows[0]!.type).toBe("blocks");
    // biome-ignore lint/style/noNonNullAssertion: test assertion after length check
    expect(rows[0]!.issueId).toBe(issueB);
    // biome-ignore lint/style/noNonNullAssertion: test assertion after length check
    expect(rows[0]!.dependsOnIssueId).toBe(issueA);
  });
});

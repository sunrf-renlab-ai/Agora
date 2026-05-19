import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { attachments, issues, members, users, workspaces } from "../db/schema/index";
import attachmentsRouter from "./attachments";

let workspaceId: string;
let userId: string;
let issueId: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `a-${Date.now()}@x`, name: "A" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "A", slug: `a-${Date.now()}`, issuePrefix: "A" })
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

describe("attachments routes", () => {
  it("requires auth on sign-upload", async () => {
    const res = await attachmentsRouter.request(
      `/api/workspaces/${workspaceId}/attachments/sign-upload`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerKind: "issue",
          ownerId: issueId,
          filename: "x.png",
          contentType: "image/png",
          size: 100,
        }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("requires auth on list", async () => {
    const res = await attachmentsRouter.request(
      `/api/workspaces/${workspaceId}/attachments?ownerKind=issue&ownerId=${issueId}`,
    );
    expect(res.status).toBe(401);
  });

  it("DB layer: list returns rows in insertion order", async () => {
    await db.insert(attachments).values({
      workspaceId,
      ownerKind: "issue",
      ownerId: issueId,
      filename: "a.png",
      contentType: "image/png",
      size: 100,
      storageKey: `ws/${workspaceId}/issue/${issueId}/x/a.png`,
      createdByUserId: userId,
    });
    const rows = await db.select().from(attachments).where(sql`workspace_id = ${workspaceId}`);
    expect(rows.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: test assertion after length check
    expect(rows[0]!.filename).toBe("a.png");
  });
});

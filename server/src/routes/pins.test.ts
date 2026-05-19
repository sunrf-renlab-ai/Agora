import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { members, users, workspaces } from "../db/schema/index";
import pinsRouter from "./pins";

let workspaceId: string;
let userId: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `pins-${Date.now()}-${Math.floor(Math.random() * 1e6)}@x`, name: "Pins" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({
      name: "Pins",
      slug: `pins-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      issuePrefix: "PIN",
    })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  workspaceId = w!.id;
  await db.insert(members).values({ workspaceId, userId, role: "owner" });
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("pins routes", () => {
  it("requires auth on list", async () => {
    const res = await pinsRouter.request(`/api/workspaces/${workspaceId}/pins`);
    expect(res.status).toBe(401);
  });

  it("requires auth on create", async () => {
    const res = await pinsRouter.request(`/api/workspaces/${workspaceId}/pins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemType: "issue",
        itemId: "00000000-0000-0000-0000-000000000000",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("requires auth on delete", async () => {
    const res = await pinsRouter.request(
      `/api/workspaces/${workspaceId}/pins/00000000-0000-0000-0000-000000000000`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(401);
  });
});

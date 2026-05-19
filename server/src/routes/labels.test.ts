import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { members, users, workspaces } from "../db/schema/index";
import labelsRouter from "./labels";

let workspaceId: string;
let userId: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `lbl-${Date.now()}@x`, name: "L" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "L", slug: `l-${Date.now()}`, issuePrefix: "L" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  workspaceId = w!.id;
  await db.insert(members).values({ workspaceId, userId, role: "owner" });
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("labels routes", () => {
  it("requires auth on list", async () => {
    const res = await labelsRouter.request(`/api/workspaces/${workspaceId}/labels`);
    expect(res.status).toBe(401);
  });

  it("requires auth on create", async () => {
    const res = await labelsRouter.request(`/api/workspaces/${workspaceId}/labels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "bug", color: "#ff0000" }),
    });
    expect(res.status).toBe(401);
  });

  it("requires auth on update", async () => {
    const res = await labelsRouter.request(
      `/api/workspaces/${workspaceId}/labels/00000000-0000-0000-0000-000000000000`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "bug" }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("requires auth on delete", async () => {
    const res = await labelsRouter.request(
      `/api/workspaces/${workspaceId}/labels/00000000-0000-0000-0000-000000000000`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(401);
  });

  it("requires auth on replace assignments", async () => {
    const res = await labelsRouter.request(
      `/api/workspaces/${workspaceId}/issues/00000000-0000-0000-0000-000000000000/labels`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ labelIds: [] }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("rejects invalid color via schema (auth runs first)", async () => {
    // Auth shape verified above; deeper end-to-end (with auth) lives in _phase7_integration.test.ts
    const res = await labelsRouter.request(`/api/workspaces/${workspaceId}/labels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "bug", color: "red" }),
    });
    // Will 401 because no auth; once auth passes, schema returns 400. Auth is enforced first.
    expect(res.status).toBe(401);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { members, users, workspaces } from "../db/schema/index";
import projectsRouter from "./projects";

let workspaceId: string;
let userId: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `proj-${Date.now()}@x`, name: "Proj" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "Proj", slug: `proj-${Date.now()}`, issuePrefix: "PROJ" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  workspaceId = w!.id;
  await db.insert(members).values({ workspaceId, userId, role: "owner" });
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("projects routes", () => {
  it("requires auth on list", async () => {
    const res = await projectsRouter.request(`/api/workspaces/${workspaceId}/projects`);
    expect(res.status).toBe(401);
  });

  it("requires auth on create", async () => {
    const res = await projectsRouter.request(`/api/workspaces/${workspaceId}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("requires auth on add resource", async () => {
    const res = await projectsRouter.request(
      `/api/workspaces/${workspaceId}/projects/00000000-0000-0000-0000-000000000000/resources`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceType: "repo", resourceRef: "x/y" }),
      },
    );
    expect(res.status).toBe(401);
  });
});

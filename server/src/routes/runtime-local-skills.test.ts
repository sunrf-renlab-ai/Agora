import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  members,
  runtimeLocalSkillImportRequests,
  runtimeLocalSkillListRequests,
  runtimes,
  skills,
  users,
  workspaces,
} from "../db/schema/index";
import { generateMachineToken } from "../lib/machine-token";
import router from "./runtime-local-skills";

let workspaceId: string;
let userId: string;
let runtimeId: string;
let machineToken: string;
let otherWorkspaceId: string;
let otherUserId: string;
let otherRuntimeId: string;
let otherMachineToken: string;

async function makeFixture(prefix: string) {
  const [u] = await db
    .insert(users)
    .values({ email: `${prefix}-${Date.now()}-${Math.random()}@x`, name: prefix })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  const uid = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({
      name: prefix,
      slug: `${prefix}-${Date.now()}-${Math.random()}`.replace(/\./g, "-"),
      issuePrefix: prefix.slice(0, 3).toUpperCase(),
    })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  const wid = w!.id;
  const [m] = await db
    .insert(members)
    .values({ workspaceId: wid, userId: uid, role: "owner" })
    .returning();
  const tok = generateMachineToken();
  const [r] = await db
    .insert(runtimes)
    .values({
      workspaceId: wid,
      // biome-ignore lint/style/noNonNullAssertion: test setup
      memberId: m!.id,
      name: "rt",
      machineTokenHash: tok.hash,
      daemonVersion: "0.0.1",
      online: true,
    })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  return { uid, wid, rid: r!.id, token: tok.token };
}

beforeEach(async () => {
  const f = await makeFixture("rls");
  userId = f.uid;
  workspaceId = f.wid;
  runtimeId = f.rid;
  machineToken = f.token;

  const f2 = await makeFixture("oth");
  otherUserId = f2.uid;
  otherWorkspaceId = f2.wid;
  otherRuntimeId = f2.rid;
  otherMachineToken = f2.token;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id IN (${workspaceId}, ${otherWorkspaceId})`);
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${userId}, ${otherUserId})`);
});

describe("runtime local-skills routes (auth)", () => {
  it("list create requires auth", async () => {
    const res = await router.request(
      `/api/workspaces/${workspaceId}/runtimes/${runtimeId}/local-skills/list`,
      { method: "POST" },
    );
    expect(res.status).toBe(401);
  });

  it("list poll requires auth", async () => {
    const res = await router.request(
      `/api/workspaces/${workspaceId}/runtimes/${runtimeId}/local-skills/list/00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status).toBe(401);
  });

  it("import create requires auth", async () => {
    const res = await router.request(
      `/api/workspaces/${workspaceId}/runtimes/${runtimeId}/local-skills/import`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillKey: "k" }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("import poll requires auth", async () => {
    const res = await router.request(
      `/api/workspaces/${workspaceId}/runtimes/${runtimeId}/local-skills/import/00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status).toBe(401);
  });

  it("daemon list callback requires daemon token", async () => {
    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/list/00000000-0000-0000-0000-000000000000`,
      { method: "POST", body: "{}" },
    );
    expect(res.status).toBe(401);
  });

  it("daemon import callback requires daemon token", async () => {
    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/import/00000000-0000-0000-0000-000000000000`,
      { method: "POST", body: "{}" },
    );
    expect(res.status).toBe(401);
  });
});

describe("runtime local-skills daemon callbacks: list", () => {
  it("daemon callback updates list request to completed with skills", async () => {
    const [row] = await db
      .insert(runtimeLocalSkillListRequests)
      .values({ runtimeId, creatorId: userId, status: "pending" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const reqId = row!.id;

    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/list/${reqId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${machineToken}`,
        },
        body: JSON.stringify({
          skills: [
            {
              key: "k1",
              name: "skill-one",
              description: "first",
              sourcePath: "/p",
              provider: "anthropic",
              fileCount: 2,
            },
          ],
          supported: true,
        }),
      },
    );
    expect(res.status).toBe(200);

    const refreshed = await db.query.runtimeLocalSkillListRequests.findFirst({
      where: eq(runtimeLocalSkillListRequests.id, reqId),
    });
    expect(refreshed?.status).toBe("completed");
    expect(refreshed?.error).toBe("");
    expect(Array.isArray(refreshed?.skills)).toBe(true);
    expect((refreshed?.skills as { key: string }[])[0]?.key).toBe("k1");
  });

  it("daemon callback marks list failed when error provided", async () => {
    const [row] = await db
      .insert(runtimeLocalSkillListRequests)
      .values({ runtimeId, creatorId: userId, status: "pending" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const reqId = row!.id;

    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/list/${reqId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${machineToken}`,
        },
        body: JSON.stringify({ error: "no permission" }),
      },
    );
    expect(res.status).toBe(200);

    const refreshed = await db.query.runtimeLocalSkillListRequests.findFirst({
      where: eq(runtimeLocalSkillListRequests.id, reqId),
    });
    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.error).toBe("no permission");
  });

  it("daemon callback rejects mismatched runtime token", async () => {
    const [row] = await db
      .insert(runtimeLocalSkillListRequests)
      .values({ runtimeId, creatorId: userId, status: "pending" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const reqId = row!.id;

    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/list/${reqId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${otherMachineToken}`,
        },
        body: JSON.stringify({ skills: [], supported: true }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("daemon callback returns 404 for unknown request id", async () => {
    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/list/00000000-0000-0000-0000-000000000000`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${machineToken}`,
        },
        body: JSON.stringify({ skills: [], supported: true }),
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("runtime local-skills daemon callbacks: import", () => {
  it("import callback inserts skill + files and links skillId", async () => {
    const [row] = await db
      .insert(runtimeLocalSkillImportRequests)
      .values({
        runtimeId,
        creatorId: userId,
        skillKey: "anthropic/foo",
        name: "",
        description: "",
        status: "pending",
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const reqId = row!.id;

    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/import/${reqId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${machineToken}`,
        },
        body: JSON.stringify({
          skill: {
            name: "foo-skill",
            description: "imported foo",
            content: "# foo body",
            files: [{ path: "extra.md", content: "hello" }],
          },
        }),
      },
    );
    expect(res.status).toBe(200);

    const refreshed = await db.query.runtimeLocalSkillImportRequests.findFirst({
      where: eq(runtimeLocalSkillImportRequests.id, reqId),
    });
    expect(refreshed?.status).toBe("completed");
    expect(refreshed?.skillId).toBeTruthy();
    expect(refreshed?.error).toBe("");

    const created = await db.query.skills.findFirst({
      // biome-ignore lint/style/noNonNullAssertion: tested above
      where: and(eq(skills.id, refreshed!.skillId!), eq(skills.workspaceId, workspaceId)),
    });
    expect(created?.name).toBe("foo-skill");
    expect(created?.description).toBe("imported foo");
    expect(created?.content).toBe("# foo body");
    expect(created?.ownerId).toBe(userId);
  });

  it("import callback prefers user-provided name/description over daemon-reported", async () => {
    const [row] = await db
      .insert(runtimeLocalSkillImportRequests)
      .values({
        runtimeId,
        creatorId: userId,
        skillKey: "anthropic/bar",
        name: "user-named",
        description: "user-desc",
        status: "pending",
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const reqId = row!.id;

    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/import/${reqId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${machineToken}`,
        },
        body: JSON.stringify({
          skill: {
            name: "daemon-name",
            description: "daemon-desc",
            content: "x",
            files: [],
          },
        }),
      },
    );
    expect(res.status).toBe(200);

    const refreshed = await db.query.runtimeLocalSkillImportRequests.findFirst({
      where: eq(runtimeLocalSkillImportRequests.id, reqId),
    });
    const created = await db.query.skills.findFirst({
      where: eq(skills.id, refreshed?.skillId as string),
    });
    expect(created?.name).toBe("user-named");
    expect(created?.description).toBe("user-desc");
  });

  it("import callback marks failed when error provided", async () => {
    const [row] = await db
      .insert(runtimeLocalSkillImportRequests)
      .values({
        runtimeId,
        creatorId: userId,
        skillKey: "k",
        status: "pending",
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const reqId = row!.id;

    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/import/${reqId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${machineToken}`,
        },
        body: JSON.stringify({ error: "skill not found" }),
      },
    );
    expect(res.status).toBe(200);

    const refreshed = await db.query.runtimeLocalSkillImportRequests.findFirst({
      where: eq(runtimeLocalSkillImportRequests.id, reqId),
    });
    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.error).toBe("skill not found");
    expect(refreshed?.skillId).toBeNull();
  });

  it("import callback marks failed when daemon omits skill payload", async () => {
    const [row] = await db
      .insert(runtimeLocalSkillImportRequests)
      .values({ runtimeId, creatorId: userId, skillKey: "k", status: "pending" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const reqId = row!.id;

    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/import/${reqId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${machineToken}`,
        },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(200);

    const refreshed = await db.query.runtimeLocalSkillImportRequests.findFirst({
      where: eq(runtimeLocalSkillImportRequests.id, reqId),
    });
    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.skillId).toBeNull();
  });

  it("import callback marks failed when skill name conflicts", async () => {
    // Pre-insert a skill with the name daemon will report.
    await db
      .insert(skills)
      .values({ workspaceId, ownerId: userId, name: "dup", description: "", content: "" });

    const [row] = await db
      .insert(runtimeLocalSkillImportRequests)
      .values({ runtimeId, creatorId: userId, skillKey: "k", status: "pending" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const reqId = row!.id;

    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/import/${reqId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${machineToken}`,
        },
        body: JSON.stringify({
          skill: { name: "dup", description: "", content: "", files: [] },
        }),
      },
    );
    expect(res.status).toBe(200);

    const refreshed = await db.query.runtimeLocalSkillImportRequests.findFirst({
      where: eq(runtimeLocalSkillImportRequests.id, reqId),
    });
    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.error).toContain("already exists");
  });

  it("import callback rejects mismatched runtime token", async () => {
    const [row] = await db
      .insert(runtimeLocalSkillImportRequests)
      .values({ runtimeId, creatorId: userId, skillKey: "k", status: "pending" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const reqId = row!.id;

    const res = await router.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/import/${reqId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${otherMachineToken}`,
        },
        body: JSON.stringify({
          skill: { name: "x", description: "", content: "", files: [] },
        }),
      },
    );
    expect(res.status).toBe(403);
  });
});

// Note: the user-facing POST routes need a valid Supabase JWT (auth middleware
// hits a remote JWKS), so we cover them via auth-required tests above and
// exercise the controller logic for daemon callbacks directly.

// Sanity: daemon callback updates the row that the user route would later poll.
describe("runtime local-skills end-to-end (DB)", () => {
  it("creating a list request directly + daemon completing it makes the row queryable", async () => {
    const [row] = await db
      .insert(runtimeLocalSkillListRequests)
      .values({ runtimeId, creatorId: userId, status: "pending" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    expect(row!.status).toBe("pending");

    await router.request(
      // biome-ignore lint/style/noNonNullAssertion: test setup
      `/api/daemon/runtimes/${runtimeId}/local-skills/list/${row!.id}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${machineToken}`,
        },
        body: JSON.stringify({ skills: [], supported: false, error: "" }),
      },
    );

    const after = await db.query.runtimeLocalSkillListRequests.findFirst({
      // biome-ignore lint/style/noNonNullAssertion: test setup
      where: eq(runtimeLocalSkillListRequests.id, row!.id),
    });
    expect(after?.status).toBe("completed");
    expect(after?.supported).toBe(false);
  });
});

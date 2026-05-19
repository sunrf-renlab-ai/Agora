import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  members,
  personalAccessTokens,
  skillFiles,
  skills,
  users,
  workspaces,
} from "../db/schema/index";
import { generatePat } from "../lib/pat-token";
import { hub } from "../lib/ws-hub";
import skillsRouter from "./skills";

// Fixture state — populated by beforeEach, torn down by afterEach.
let workspaceId: string;
let workspaceBId: string; // a second workspace for isolation tests
let userId: string;
let outsiderId: string; // a user who is NOT a member of `workspaceId`
let userToken: string; // PAT for the workspace member
let outsiderToken: string; // PAT for the non-member
let skillId: string;

function authHeaders(token: string, ws: string = workspaceId) {
  return {
    "content-type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Workspace-ID": ws,
  };
}

async function makeUserAndPat(prefix: string) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [u] = await db
    .insert(users)
    .values({ email: `${prefix}-${stamp}@x`, name: prefix })
    .returning();
  if (!u) throw new Error("failed to insert user");
  const { token, hash, prefix: tp } = generatePat();
  await db.insert(personalAccessTokens).values({
    userId: u.id,
    name: `${prefix}-test`,
    tokenHash: hash,
    tokenPrefix: tp,
  });
  return { id: u.id, token };
}

async function makeWorkspace(prefix: string) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [w] = await db
    .insert(workspaces)
    .values({
      name: prefix,
      slug: `${prefix}-${stamp}`.toLowerCase(),
      issuePrefix: prefix.slice(0, 3).toUpperCase(),
    })
    .returning();
  if (!w) throw new Error("failed to insert workspace");
  return w.id;
}

// Capture-broadcast helper: replace hub.broadcast with a spy that records calls
// for the duration of one test, restoring the original afterwards.
function captureBroadcasts() {
  const calls: { channel: string; event: unknown }[] = [];
  const original = hub.broadcast;
  hub.broadcast = (channel, event) => {
    calls.push({ channel, event });
  };
  return {
    calls,
    restore() {
      hub.broadcast = original;
    },
  };
}

beforeEach(async () => {
  const u = await makeUserAndPat("sk-member");
  userId = u.id;
  userToken = u.token;

  const o = await makeUserAndPat("sk-outsider");
  outsiderId = o.id;
  outsiderToken = o.token;

  workspaceId = await makeWorkspace("Sk");
  workspaceBId = await makeWorkspace("SkB");

  await db.insert(members).values({ workspaceId, userId, role: "owner" });
  // Outsider is intentionally NOT a member of workspaceId.
  // Outsider IS a member of workspaceBId (so they can cross-probe).
  await db.insert(members).values({ workspaceId: workspaceBId, userId: outsiderId, role: "owner" });

  const [s] = await db
    .insert(skills)
    .values({
      workspaceId,
      ownerId: userId,
      name: "skill-a",
      description: "test skill",
      content: "# body",
    })
    .returning();
  if (!s) throw new Error("failed to insert skill");
  skillId = s.id;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id IN (${workspaceId}, ${workspaceBId})`);
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${userId}, ${outsiderId})`);
});

// ---------------------------------------------------------------------------
// Original auth-shape tests (kept for backward compat with the file's audit)
// ---------------------------------------------------------------------------

describe("skills routes — auth shape", () => {
  it("requires auth on list", async () => {
    const res = await skillsRouter.request(`/api/workspaces/${workspaceId}/skills`);
    expect(res.status).toBe(401);
  });

  it("requires auth on create", async () => {
    const res = await skillsRouter.request(`/api/workspaces/${workspaceId}/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("requires auth on detail", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Skill files sub-resource: integration tests for GET/PUT/DELETE
// ---------------------------------------------------------------------------

describe("skill files — happy path", () => {
  it("upsert, list, delete round-trip works end-to-end", async () => {
    // 1. upsert one file
    const putRes = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      {
        method: "POST",
        headers: authHeaders(userToken),
        body: JSON.stringify({ path: "notes.md", content: "hello" }),
      },
    );
    expect(putRes.status).toBe(200);
    const created = (await putRes.json()) as { id: string; path: string; content: string };
    expect(created.path).toBe("notes.md");
    expect(created.content).toBe("hello");

    // 2. list returns it
    const listRes = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      { headers: authHeaders(userToken) },
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string; path: string }[];
    expect(list.length).toBe(1);
    expect(list[0]?.path).toBe("notes.md");

    // 3. delete it
    const delRes = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files/${created.id}`,
      { method: "DELETE", headers: authHeaders(userToken) },
    );
    expect(delRes.status).toBe(204);

    // 4. list is empty now
    const listRes2 = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      { headers: authHeaders(userToken) },
    );
    expect(listRes2.status).toBe(200);
    const list2 = (await listRes2.json()) as unknown[];
    expect(list2.length).toBe(0);
  });
});

describe("skill files — multiple files", () => {
  it("upsert two different paths, list returns both, delete one leaves the other", async () => {
    const a = await skillsRouter.request(`/api/workspaces/${workspaceId}/skills/${skillId}/files`, {
      method: "POST",
      headers: authHeaders(userToken),
      body: JSON.stringify({ path: "a.md", content: "A" }),
    });
    expect(a.status).toBe(200);
    const fileA = (await a.json()) as { id: string };

    const b = await skillsRouter.request(`/api/workspaces/${workspaceId}/skills/${skillId}/files`, {
      method: "POST",
      headers: authHeaders(userToken),
      body: JSON.stringify({ path: "b.md", content: "B" }),
    });
    expect(b.status).toBe(200);

    const list1 = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      { headers: authHeaders(userToken) },
    );
    const arr1 = (await list1.json()) as { path: string }[];
    expect(arr1.map((f) => f.path).sort()).toEqual(["a.md", "b.md"]);

    // delete A, B should remain
    const del = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files/${fileA.id}`,
      { method: "DELETE", headers: authHeaders(userToken) },
    );
    expect(del.status).toBe(204);

    const list2 = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      { headers: authHeaders(userToken) },
    );
    const arr2 = (await list2.json()) as { path: string }[];
    expect(arr2.map((f) => f.path)).toEqual(["b.md"]);
  });
});

describe("skill files — upsert idempotency", () => {
  it("upserting same path twice replaces content and yields one row", async () => {
    const first = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      {
        method: "POST",
        headers: authHeaders(userToken),
        body: JSON.stringify({ path: "notes.md", content: "v1" }),
      },
    );
    expect(first.status).toBe(200);
    const f1 = (await first.json()) as { id: string; content: string };
    expect(f1.content).toBe("v1");

    const second = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      {
        method: "POST",
        headers: authHeaders(userToken),
        body: JSON.stringify({ path: "notes.md", content: "v2" }),
      },
    );
    expect(second.status).toBe(200);
    const f2 = (await second.json()) as { id: string; content: string };
    expect(f2.content).toBe("v2");
    // Natural-key upsert: same row, content replaced.
    expect(f2.id).toBe(f1.id);

    const rows = await db.select().from(skillFiles).where(eq(skillFiles.skillId, skillId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.content).toBe("v2");
  });
});

describe("skill files — path validation", () => {
  it("rejects empty path with 400", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      {
        method: "POST",
        headers: authHeaders(userToken),
        body: JSON.stringify({ path: "", content: "x" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects path containing .. (traversal) with 400", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      {
        method: "POST",
        headers: authHeaders(userToken),
        body: JSON.stringify({ path: "../etc/passwd", content: "x" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects absolute path (leading /) with 400", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      {
        method: "POST",
        headers: authHeaders(userToken),
        body: JSON.stringify({ path: "/etc/passwd", content: "x" }),
      },
    );
    expect(res.status).toBe(400);
  });
});

describe("skill files — auth and membership", () => {
  it("list returns 401 without auth", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
    );
    expect(res.status).toBe(401);
  });

  it("PUT returns 403 when caller is not a workspace member", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      {
        method: "POST",
        headers: authHeaders(outsiderToken, workspaceId),
        body: JSON.stringify({ path: "x.md", content: "x" }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("DELETE returns 403 when caller is not a workspace member", async () => {
    // Seed a file directly so the row exists.
    const [row] = await db
      .insert(skillFiles)
      .values({ skillId, path: "seed.md", content: "x" })
      .returning();
    if (!row) throw new Error("failed to insert file");

    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files/${row.id}`,
      { method: "DELETE", headers: authHeaders(outsiderToken, workspaceId) },
    );
    expect(res.status).toBe(403);
  });

  it("GET (list) returns 403 when caller is not a workspace member", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      { headers: authHeaders(outsiderToken, workspaceId) },
    );
    // workspaceMiddleware rejects non-members with 403.
    expect(res.status).toBe(403);
  });
});

describe("skill files — 404 handling", () => {
  const ghostSkill = "00000000-0000-0000-0000-000000000000";

  it("list returns 404 for non-existent skill", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${ghostSkill}/files`,
      { headers: authHeaders(userToken) },
    );
    expect(res.status).toBe(404);
  });

  it("upsert returns 404 for non-existent skill", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${ghostSkill}/files`,
      {
        method: "POST",
        headers: authHeaders(userToken),
        body: JSON.stringify({ path: "x.md", content: "x" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("delete returns 404 for non-existent skill", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${ghostSkill}/files/${ghostSkill}`,
      { method: "DELETE", headers: authHeaders(userToken) },
    );
    expect(res.status).toBe(404);
  });

  it("delete with non-existent fileId on real skill returns 404", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files/${ghostSkill}`,
      { method: "DELETE", headers: authHeaders(userToken) },
    );
    expect(res.status).toBe(404);
  });
});

describe("skill files — workspace isolation", () => {
  // The skill lives in workspaceId (A). Outsider is a member of workspaceBId.
  // Outsider hits the route via workspaceBId URL + header. The workspace
  // middleware passes (outsider is a member of B), but the route's
  // skill-by-workspace lookup must return 404 because the skill belongs to A.
  it("list via foreign workspace URL returns 404 (skill lives in workspace A)", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceBId}/skills/${skillId}/files`,
      { headers: authHeaders(outsiderToken, workspaceBId) },
    );
    expect(res.status).toBe(404);
  });

  it("upsert via foreign workspace URL returns 404", async () => {
    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceBId}/skills/${skillId}/files`,
      {
        method: "POST",
        headers: authHeaders(outsiderToken, workspaceBId),
        body: JSON.stringify({ path: "x.md", content: "x" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("delete via foreign workspace URL returns 404", async () => {
    const [row] = await db
      .insert(skillFiles)
      .values({ skillId, path: "iso.md", content: "x" })
      .returning();
    if (!row) throw new Error("failed to insert file");

    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceBId}/skills/${skillId}/files/${row.id}`,
      { method: "DELETE", headers: authHeaders(outsiderToken, workspaceBId) },
    );
    expect(res.status).toBe(404);
  });
});

describe("skill files — skill.updatedAt bump", () => {
  it("upsert bumps skill.updatedAt", async () => {
    // Force the stored updatedAt to a value in the past so the assertion
    // below isn't sensitive to clock resolution (the row was just inserted
    // in beforeEach, and Postgres timestamps share microsecond precision).
    await db
      .update(skills)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(skills.id, skillId));
    const before = await db.query.skills.findFirst({ where: eq(skills.id, skillId) });
    if (!before) throw new Error("skill missing");

    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
      {
        method: "POST",
        headers: authHeaders(userToken),
        body: JSON.stringify({ path: "bump.md", content: "x" }),
      },
    );
    expect(res.status).toBe(200);

    const after = await db.query.skills.findFirst({ where: eq(skills.id, skillId) });
    if (!after) throw new Error("skill missing");
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("delete bumps skill.updatedAt", async () => {
    const [row] = await db
      .insert(skillFiles)
      .values({ skillId, path: "del.md", content: "x" })
      .returning();
    if (!row) throw new Error("failed to insert file");
    await db
      .update(skills)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(skills.id, skillId));
    const before = await db.query.skills.findFirst({ where: eq(skills.id, skillId) });
    if (!before) throw new Error("skill missing");

    const res = await skillsRouter.request(
      `/api/workspaces/${workspaceId}/skills/${skillId}/files/${row.id}`,
      { method: "DELETE", headers: authHeaders(userToken) },
    );
    expect(res.status).toBe(204);

    const after = await db.query.skills.findFirst({ where: eq(skills.id, skillId) });
    if (!after) throw new Error("skill missing");
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });
});

describe("skill files — WS broadcast", () => {
  it("upsert fires skill.updated broadcast", async () => {
    const spy = captureBroadcasts();
    try {
      const res = await skillsRouter.request(
        `/api/workspaces/${workspaceId}/skills/${skillId}/files`,
        {
          method: "POST",
          headers: authHeaders(userToken),
          body: JSON.stringify({ path: "x.md", content: "x" }),
        },
      );
      expect(res.status).toBe(200);
      const matching = spy.calls.filter(
        (call) =>
          call.channel === `workspace:${workspaceId}` &&
          (call.event as { type: string }).type === "skill.updated",
      );
      expect(matching.length).toBe(1);
      const payload = matching[0]?.event as {
        type: string;
        data: { id: string; workspaceId: string };
      };
      expect(payload.data.id).toBe(skillId);
      expect(payload.data.workspaceId).toBe(workspaceId);
    } finally {
      spy.restore();
    }
  });

  it("delete fires skill.updated broadcast", async () => {
    const [row] = await db
      .insert(skillFiles)
      .values({ skillId, path: "ws.md", content: "x" })
      .returning();
    if (!row) throw new Error("failed to insert file");

    const spy = captureBroadcasts();
    try {
      const res = await skillsRouter.request(
        `/api/workspaces/${workspaceId}/skills/${skillId}/files/${row.id}`,
        { method: "DELETE", headers: authHeaders(userToken) },
      );
      expect(res.status).toBe(204);
      const matching = spy.calls.filter(
        (call) =>
          call.channel === `workspace:${workspaceId}` &&
          (call.event as { type: string }).type === "skill.updated",
      );
      expect(matching.length).toBe(1);
    } finally {
      spy.restore();
    }
  });

  it("delete that returns 404 does NOT fire a broadcast", async () => {
    const spy = captureBroadcasts();
    try {
      const res = await skillsRouter.request(
        `/api/workspaces/${workspaceId}/skills/${skillId}/files/00000000-0000-0000-0000-000000000000`,
        { method: "DELETE", headers: authHeaders(userToken) },
      );
      expect(res.status).toBe(404);
      const matching = spy.calls.filter(
        (call) => (call.event as { type: string }).type === "skill.updated",
      );
      expect(matching.length).toBe(0);
    } finally {
      spy.restore();
    }
  });
});

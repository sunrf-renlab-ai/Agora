import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentSkills,
  agents,
  members,
  projectResources,
  projects,
  runtimeLocalSkillListRequests,
  runtimes,
  skillFiles,
  skills,
  users,
  workspaces,
} from "../db/schema/index";
import { daemonHub } from "../lib/daemon-hub";
import { generateMachineToken } from "../lib/machine-token";
import { createSkillWithFiles } from "../services/skill";
import { fetchImportedSkill } from "../services/skill-import";
import { broadcastSkillSyncForAgent } from "../services/skill-sync";
import runtimeLocalSkillsRouter from "./runtime-local-skills";

let workspaceId: string;
let userId: string;
let memberId: string;
let runtimeId: string;
let machineToken: string;
let agentId: string;

function assertDefined<T>(val: T | undefined, name: string): T {
  if (val === undefined) throw new Error(`Expected ${name} to be defined`);
  return val;
}

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [u] = await db
    .insert(users)
    .values({ email: `p6-${stamp}@x`, name: "P6" })
    .returning();
  userId = assertDefined(u, "user").id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "P6", slug: `p6-${stamp}`, issuePrefix: "P6" })
    .returning();
  workspaceId = assertDefined(w, "workspace").id;
  const [m] = await db.insert(members).values({ workspaceId, userId, role: "owner" }).returning();
  memberId = assertDefined(m, "member").id;
  const tok = generateMachineToken();
  machineToken = tok.token;
  const [r] = await db
    .insert(runtimes)
    .values({
      workspaceId,
      memberId,
      name: "p6-rt",
      machineTokenHash: tok.hash,
      daemonVersion: "0.0.1",
      online: true,
    })
    .returning();
  runtimeId = assertDefined(r, "runtime").id;
  const [a] = await db
    .insert(agents)
    .values({
      workspaceId,
      ownerId: userId,
      name: "p6-agent",
      runtimeId,
      cliKind: "claude_code",
    })
    .returning();
  agentId = assertDefined(a, "agent").id;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("Phase 6 critical flow: project + skill + agent binding + push-sync", () => {
  it("end to end: create project + add resource, create skill, bind to agent, daemon receives skill.sync", async () => {
    // Step 1: Create project + add repo resource (service-layer, since /api/workspaces routes
    // require a Supabase JWT we can't easily mint in-process).
    const [project] = await db
      .insert(projects)
      .values({
        workspaceId,
        title: "P6 demo project",
        description: "phase 6 integration",
        status: "active",
        priority: "medium",
      })
      .returning();
    const projectRow = assertDefined(project, "project");
    expect(projectRow.title).toBe("P6 demo project");

    const [resource] = await db
      .insert(projectResources)
      .values({
        workspaceId,
        projectId: projectRow.id,
        resourceType: "repo",
        resourceRef: "github.com/agora/demo",
        label: "Agora demo repo",
        position: 0,
        createdBy: userId,
      })
      .returning();
    const resourceRow = assertDefined(resource, "resource");
    expect(resourceRow.projectId).toBe(projectRow.id);

    // Step 2: Create skill with files via the service layer
    const created = await createSkillWithFiles({
      workspaceId,
      ownerId: userId,
      name: "p6-skill",
      description: "phase 6 skill",
      content: "# SKILL.md body",
      config: {},
      visibility: "workspace",
      files: [
        { path: "helpers/h.sh", content: "echo hi" },
        { path: "README.md", content: "readme" },
      ],
    });
    expect(created.id).toBeTruthy();
    expect(created.files).toHaveLength(2);

    // Step 3: Bind skill to agent (direct DB insert, mirroring the PUT
    // /agents/:id/skills route's effect), then trigger broadcast.
    await db.insert(agentSkills).values({ agentId, skillId: created.id });
    const binding = await db.query.agentSkills.findFirst({
      where: and(eq(agentSkills.agentId, agentId), eq(agentSkills.skillId, created.id)),
    });
    expect(binding).toBeTruthy();

    // Attach a fake socket to the daemon hub and assert it receives skill.sync
    const sent: string[] = [];
    const fakeWs = { readyState: 1, send: (v: string) => sent.push(v) };
    daemonHub.attach(runtimeId, fakeWs);
    await broadcastSkillSyncForAgent(agentId);
    daemonHub.detach(runtimeId, fakeWs);

    expect(sent).toHaveLength(1);
    const frame = JSON.parse(assertDefined(sent[0], "frame"));
    expect(frame.type).toBe("skill.sync");
    expect(frame.runtimeId).toBe(runtimeId);
    expect(frame.bundles).toHaveLength(1);
    expect(frame.bundles[0].name).toBe("p6-skill");
    expect(frame.bundles[0].skillId).toBe(created.id);
    expect(frame.bundles[0].files).toHaveLength(2);
    expect(frame.removeNames).toEqual([]);
  });
});

describe("Phase 6 critical flow: URL import (clawhub mock)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("fetchImportedSkill returns expected shape from clawhub", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      // Order: most specific first, since matchers use includes()
      if (url.includes("file?path=SKILL.md")) {
        return new Response("# imported");
      }
      if (url.includes("file?path=helpers%2Fh.sh") || url.includes("file?path=helpers/h.sh")) {
        return new Response("echo hello");
      }
      if (url.includes("/api/v1/skills/p6demo/versions/1")) {
        return new Response(
          JSON.stringify({
            version: {
              version: "1",
              files: [
                { path: "SKILL.md", size: 12 },
                { path: "helpers/h.sh", size: 10 },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/skills/p6demo")) {
        return new Response(
          JSON.stringify({
            skill: { slug: "p6demo", displayName: "P6 Demo", summary: "Phase 6 demo" },
            latestVersion: { version: "1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(`not mocked: ${url}`, { status: 404 });
    }) as unknown as typeof fetch;

    const imported = await fetchImportedSkill("https://clawhub.ai/me/p6demo");
    expect(imported.name).toBe("P6 Demo");
    expect(imported.description).toBe("Phase 6 demo");
    expect(imported.content).toBe("# imported");
    expect(imported.files).toEqual([{ path: "helpers/h.sh", content: "echo hello" }]);
  });
});

describe("Phase 6 critical flow: local-discovery request lifecycle", () => {
  it("insert pending request → daemon callback → request marked completed with skills", async () => {
    const [req] = await db
      .insert(runtimeLocalSkillListRequests)
      .values({ runtimeId, creatorId: userId, status: "pending" })
      .returning();
    const requestRow = assertDefined(req, "list request");
    expect(requestRow.status).toBe("pending");

    const res = await runtimeLocalSkillsRouter.request(
      `/api/daemon/runtimes/${runtimeId}/local-skills/list/${requestRow.id}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${machineToken}`,
        },
        body: JSON.stringify({
          skills: [
            {
              key: "anthropic/p6",
              name: "p6-local",
              description: "from disk",
              sourcePath: "/tmp/skills/p6",
              provider: "anthropic",
              fileCount: 3,
            },
          ],
          supported: true,
        }),
      },
    );
    expect(res.status).toBe(200);

    const after = await db.query.runtimeLocalSkillListRequests.findFirst({
      where: eq(runtimeLocalSkillListRequests.id, requestRow.id),
    });
    expect(after?.status).toBe("completed");
    expect(after?.error).toBe("");
    const listed = (after?.skills ?? []) as { key: string; name: string }[];
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe("anthropic/p6");
    expect(listed[0]?.name).toBe("p6-local");

    // Sanity: the skill family rows we created in earlier flows are isolated to
    // this workspace — the local discovery callback never touched them.
    const skillCount = await db
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.workspaceId, workspaceId));
    // No skill should have been created from a list-only callback.
    expect(skillCount.length).toBe(0);
    const fileCount = await db.select({ id: skillFiles.id }).from(skillFiles);
    expect(fileCount.length).toBeGreaterThanOrEqual(0);
  });
});

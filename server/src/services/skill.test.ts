import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { skillFiles, skills, users, workspaces } from "../db/schema/index";
import { createSkillWithFiles, replaceSkillFiles } from "./skill";

let workspaceId: string;
let userId: string;

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `skill-svc-${Date.now()}@test.io`, name: "SK" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "SK", slug: `sk-${Date.now()}`, issuePrefix: "SK", issueCounter: 0 })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  workspaceId = w!.id;
});

afterAll(async () => {
  await db.delete(skills).where(eq(skills.workspaceId, workspaceId));
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("createSkillWithFiles", () => {
  it("inserts skill + skill_file rows and returns SkillWithFiles", async () => {
    const out = await createSkillWithFiles({
      workspaceId,
      ownerId: userId,
      name: "test-skill-1",
      description: "demo",
      content: "# SKILL.md body",
      config: {},
      visibility: "workspace",
      files: [
        { path: "scripts/run.sh", content: "echo hi" },
        { path: "README.md", content: "readme" },
      ],
    });
    expect(out.name).toBe("test-skill-1");
    expect(out.files).toHaveLength(2);
    expect(out.files.map((f) => f.path).sort()).toEqual(["README.md", "scripts/run.sh"]);
  });

  it("rejects path traversal", async () => {
    await expect(
      createSkillWithFiles({
        workspaceId,
        ownerId: userId,
        name: "test-skill-traversal",
        description: "",
        content: "",
        config: {},
        visibility: "workspace",
        files: [{ path: "../../etc/passwd", content: "x" }],
      }),
    ).rejects.toThrow(/invalid file path/);
  });

  it("rejects duplicate skill name in the same workspace", async () => {
    await expect(
      createSkillWithFiles({
        workspaceId,
        ownerId: userId,
        name: "test-skill-1",
        description: "",
        content: "",
        config: {},
        visibility: "workspace",
        files: [],
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("replaceSkillFiles", () => {
  it("deletes existing files and writes the new set", async () => {
    const skill = await createSkillWithFiles({
      workspaceId,
      ownerId: userId,
      name: "test-skill-replace",
      description: "",
      content: "",
      config: {},
      visibility: "workspace",
      files: [{ path: "old.md", content: "old" }],
    });
    const updated = await replaceSkillFiles(skill.id, [
      { path: "new.md", content: "new" },
      { path: "extra.md", content: "extra" },
    ]);
    expect(updated.map((f) => f.path).sort()).toEqual(["extra.md", "new.md"]);
    const stillThere = await db.select().from(skillFiles).where(eq(skillFiles.skillId, skill.id));
    expect(stillThere.map((f) => f.path).sort()).toEqual(["extra.md", "new.md"]);
  });
});

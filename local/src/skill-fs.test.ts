import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySkillSync, loadLocalSkillBundle, scanLocalSkills } from "./skill-fs";

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "agora-skill-test-"));
});
afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("applySkillSync", () => {
  it("writes SKILL.md + each file under <baseDir>/<name>/", async () => {
    await applySkillSync(
      baseDir,
      [
        {
          skillId: "s1",
          name: "demo",
          description: "",
          content: "# hi",
          files: [
            { path: "scripts/run.sh", content: "echo hi" },
            { path: "README.md", content: "readme" },
          ],
        },
      ],
      [],
    );
    expect(readFileSync(join(baseDir, "demo/SKILL.md"), "utf8")).toBe("# hi");
    expect(readFileSync(join(baseDir, "demo/scripts/run.sh"), "utf8")).toBe("echo hi");
    expect(readFileSync(join(baseDir, "demo/README.md"), "utf8")).toBe("readme");
  });

  it("removes files no longer in the bundle", async () => {
    await applySkillSync(
      baseDir,
      [
        {
          skillId: "s1",
          name: "demo",
          description: "",
          content: "# v1",
          files: [{ path: "old.md", content: "x" }],
        },
      ],
      [],
    );
    await applySkillSync(
      baseDir,
      [
        {
          skillId: "s1",
          name: "demo",
          description: "",
          content: "# v2",
          files: [{ path: "new.md", content: "y" }],
        },
      ],
      [],
    );
    expect(() => statSync(join(baseDir, "demo/old.md"))).toThrow();
    expect(readFileSync(join(baseDir, "demo/new.md"), "utf8")).toBe("y");
    expect(readFileSync(join(baseDir, "demo/SKILL.md"), "utf8")).toBe("# v2");
  });

  it("rejects path traversal in file paths", async () => {
    await expect(
      applySkillSync(
        baseDir,
        [
          {
            skillId: "s1",
            name: "demo",
            description: "",
            content: "x",
            files: [{ path: "../escape.md", content: "x" }],
          },
        ],
        [],
      ),
    ).rejects.toThrow(/invalid file path/);
  });

  it("rejects path traversal in skill name", async () => {
    await expect(
      applySkillSync(
        baseDir,
        [{ skillId: "s1", name: "../evil", description: "", content: "x", files: [] }],
        [],
      ),
    ).rejects.toThrow(/invalid skill name/);
  });

  it("removeNames deletes whole skill directories", async () => {
    await applySkillSync(
      baseDir,
      [{ skillId: "s1", name: "gone", description: "", content: "# x", files: [] }],
      [],
    );
    await applySkillSync(baseDir, [], ["gone"]);
    expect(() => statSync(join(baseDir, "gone"))).toThrow();
  });

  it("is idempotent when applied twice with the same input", async () => {
    const bundle = {
      skillId: "s1",
      name: "demo",
      description: "",
      content: "# v1",
      files: [{ path: "a.md", content: "a" }],
    };
    await applySkillSync(baseDir, [bundle], []);
    await applySkillSync(baseDir, [bundle], []);
    expect(readFileSync(join(baseDir, "demo/SKILL.md"), "utf8")).toBe("# v1");
    expect(readFileSync(join(baseDir, "demo/a.md"), "utf8")).toBe("a");
  });

  it("removeNames silently ignores missing dirs", async () => {
    await applySkillSync(baseDir, [], ["never-existed"]);
  });
});

describe("scanLocalSkills", () => {
  it("returns parsed frontmatter + file count for each skill dir", async () => {
    mkdirSync(join(baseDir, "alpha"), { recursive: true });
    writeFileSync(
      join(baseDir, "alpha/SKILL.md"),
      "---\nname: Alpha\ndescription: a desc\n---\nbody",
    );
    writeFileSync(join(baseDir, "alpha/run.sh"), "echo hi");

    const out = await scanLocalSkills(baseDir);
    expect(out).toHaveLength(1);
    expect(out[0]?.key).toBe("alpha");
    expect(out[0]?.name).toBe("Alpha");
    expect(out[0]?.description).toBe("a desc");
    expect(out[0]?.fileCount).toBe(2); // SKILL.md + run.sh
    expect(out[0]?.provider).toBe("claude");
  });

  it("falls back to dir basename when frontmatter has no name", async () => {
    mkdirSync(join(baseDir, "no-fm"), { recursive: true });
    writeFileSync(join(baseDir, "no-fm/SKILL.md"), "no frontmatter here");
    const out = await scanLocalSkills(baseDir);
    expect(out[0]?.name).toBe("no-fm");
    expect(out[0]?.description).toBe("");
  });

  it("ignores hidden directories and LICENSE files", async () => {
    mkdirSync(join(baseDir, ".hidden"), { recursive: true });
    writeFileSync(join(baseDir, ".hidden/SKILL.md"), "---\nname: Hidden\n---\n");
    mkdirSync(join(baseDir, "visible"), { recursive: true });
    writeFileSync(join(baseDir, "visible/SKILL.md"), "---\nname: Visible\n---\n");
    writeFileSync(join(baseDir, "visible/LICENSE"), "license text");
    const out = await scanLocalSkills(baseDir);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("Visible");
    expect(out[0]?.fileCount).toBe(1); // SKILL.md only; LICENSE ignored
  });

  it("recurses into nested dirs without SKILL.md", async () => {
    mkdirSync(join(baseDir, "group/nested"), { recursive: true });
    writeFileSync(join(baseDir, "group/nested/SKILL.md"), "---\nname: Nested\n---\n");
    const out = await scanLocalSkills(baseDir);
    expect(out).toHaveLength(1);
    expect(out[0]?.key).toBe("group/nested");
  });

  it("returns empty list when baseDir does not exist", async () => {
    const out = await scanLocalSkills(join(baseDir, "does-not-exist"));
    expect(out).toEqual([]);
  });
});

describe("loadLocalSkillBundle", () => {
  it("returns SKILL.md as content and other files in files[]", async () => {
    mkdirSync(join(baseDir, "alpha/scripts"), { recursive: true });
    writeFileSync(join(baseDir, "alpha/SKILL.md"), "---\nname: Alpha\ndescription: a\n---\nbody");
    writeFileSync(join(baseDir, "alpha/scripts/run.sh"), "echo hi");
    writeFileSync(join(baseDir, "alpha/README.md"), "readme");

    const out = await loadLocalSkillBundle(baseDir, "alpha");
    expect(out.name).toBe("Alpha");
    expect(out.description).toBe("a");
    expect(out.content).toContain("body");
    expect(out.files).toEqual([
      { path: "README.md", content: "readme" },
      { path: "scripts/run.sh", content: "echo hi" },
    ]);
  });

  it("rejects keys that escape the base dir", async () => {
    await expect(loadLocalSkillBundle(baseDir, "../etc")).rejects.toThrow(/invalid skill key/);
    await expect(loadLocalSkillBundle(baseDir, "/abs/path")).rejects.toThrow(/invalid skill key/);
  });

  it("supports nested skill keys", async () => {
    mkdirSync(join(baseDir, "group/nested"), { recursive: true });
    writeFileSync(join(baseDir, "group/nested/SKILL.md"), "---\nname: Nested\n---\nbody");
    writeFileSync(join(baseDir, "group/nested/extra.txt"), "x");
    const out = await loadLocalSkillBundle(baseDir, "group/nested");
    expect(out.name).toBe("Nested");
    expect(out.files).toEqual([{ path: "extra.txt", content: "x" }]);
  });
});

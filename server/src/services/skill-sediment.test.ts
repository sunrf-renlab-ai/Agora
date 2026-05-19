import { describe, expect, it } from "bun:test";
import { parseSedimentSkill } from "./skill-sediment";

describe("parseSedimentSkill", () => {
  it("pulls name and description from YAML frontmatter", () => {
    const out = parseSedimentSkill(
      "---\nname: deploy-cli\ndescription: Recovers a stuck Render deploy\n---\nbody here",
    );
    expect(out.name).toBe("deploy-cli");
    expect(out.description).toBe("Recovers a stuck Render deploy");
    expect(out.body).toContain("body here");
  });

  it("falls back to anonymous name when frontmatter absent", () => {
    const out = parseSedimentSkill("just a body, no frontmatter");
    expect(out.name).toBe("");
    expect(out.description).toBe("");
    expect(out.body).toBe("just a body, no frontmatter");
  });

  it("ignores unknown frontmatter keys", () => {
    const out = parseSedimentSkill(
      "---\nname: x\nrandom: thing\ndescription: y\n---\nbody",
    );
    expect(out.name).toBe("x");
    expect(out.description).toBe("y");
  });
});

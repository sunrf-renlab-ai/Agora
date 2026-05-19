import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSedimentCandidate } from "./skill-sediment";

const ROOT = join(tmpdir(), "agora-sediment-test");

beforeEach(async () => {
  await mkdir(ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe("findSedimentCandidate", () => {
  it("returns null when SKILL.md does not exist", async () => {
    const out = await findSedimentCandidate(ROOT, new Date());
    expect(out).toBeNull();
  });

  it("returns the file content when SKILL.md exists and was modified after baseline", async () => {
    const baseline = new Date(Date.now() - 10_000);
    await writeFile(join(ROOT, "SKILL.md"), "---\nname: x\n---\nbody");
    const out = await findSedimentCandidate(ROOT, baseline);
    expect(out).not.toBeNull();
    expect(out?.content).toContain("name: x");
  });

  it("returns null when SKILL.md was last modified before baseline (carry-over)", async () => {
    await writeFile(join(ROOT, "SKILL.md"), "old");
    await new Promise((r) => setTimeout(r, 50));
    const baseline = new Date();
    const out = await findSedimentCandidate(ROOT, baseline);
    expect(out).toBeNull();
  });
});

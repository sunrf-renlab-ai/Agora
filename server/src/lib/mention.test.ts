import { describe, expect, it } from "bun:test";
import { expandIssueIdentifiers, parseMentions } from "./mention";

describe("parseMentions", () => {
  it("extracts agent + member + issue mentions and dedupes", () => {
    const md =
      "ping [@alice](mention://member/aaaa) and [@bob-bot](mention://agent/bbbb) re [AGR-12](mention://issue/cccc) and [@bob-bot](mention://agent/bbbb)";
    expect(parseMentions(md)).toEqual([
      { kind: "member", id: "aaaa" },
      { kind: "agent", id: "bbbb" },
      { kind: "issue", id: "cccc" },
    ]);
  });

  it("returns [] when there are no mentions", () => {
    expect(parseMentions("just text")).toEqual([]);
  });
});

describe("expandIssueIdentifiers", () => {
  const lookup = async (number: number) => (number === 7 ? { id: "issue-7-uuid" } : null);

  it("rewrites bare AGR-7 to a markdown mention link", async () => {
    const out = await expandIssueIdentifiers("see AGR-7 plz", "AGR", lookup);
    expect(out).toBe("see [AGR-7](mention://issue/issue-7-uuid) plz");
  });

  it("leaves AGR-7 inside inline code untouched", async () => {
    const out = await expandIssueIdentifiers("see `AGR-7` plz", "AGR", lookup);
    expect(out).toBe("see `AGR-7` plz");
  });

  it("leaves AGR-7 already inside a markdown link untouched", async () => {
    const out = await expandIssueIdentifiers(
      "see [AGR-7](mention://issue/issue-7-uuid)",
      "AGR",
      lookup,
    );
    expect(out).toBe("see [AGR-7](mention://issue/issue-7-uuid)");
  });

  it("leaves unknown numbers untouched", async () => {
    const out = await expandIssueIdentifiers("see AGR-999", "AGR", lookup);
    expect(out).toBe("see AGR-999");
  });
});

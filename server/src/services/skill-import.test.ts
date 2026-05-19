import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { detectImportSource, fetchImportedSkill, parseSkillFrontmatter } from "./skill-import";

const realFetch = globalThis.fetch;
const calls: { url: string; respond: (req: Request) => Response }[] = [];

beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const c of calls) if (url.includes(c.url)) return c.respond(new Request(url));
    return new Response(`not mocked: ${url}`, { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("detectImportSource", () => {
  it("recognizes clawhub.ai", () => {
    expect(detectImportSource("https://clawhub.ai/foo/bar").source).toBe("clawhub");
  });
  it("recognizes skills.sh", () => {
    expect(detectImportSource("https://skills.sh/o/r/n").source).toBe("skills_sh");
  });
  it("rejects unknown hosts", () => {
    expect(() => detectImportSource("https://evil.example.com/x")).toThrow(/unsupported/);
  });
  it("normalizes URLs without protocol", () => {
    expect(detectImportSource("clawhub.ai/foo/bar").source).toBe("clawhub");
  });
  it("rejects empty URLs", () => {
    expect(() => detectImportSource("   ")).toThrow(/empty/);
  });
});

describe("parseSkillFrontmatter", () => {
  it("extracts name + description", () => {
    const out = parseSkillFrontmatter("---\nname: hello\ndescription: a demo\n---\nbody");
    expect(out).toEqual({ name: "hello", description: "a demo" });
  });
  it("strips quotes from values", () => {
    const out = parseSkillFrontmatter("---\nname: \"q\"\ndescription: 'd'\n---\n");
    expect(out).toEqual({ name: "q", description: "d" });
  });
  it("returns empty when no frontmatter", () => {
    expect(parseSkillFrontmatter("# hello")).toEqual({ name: "", description: "" });
  });
});

describe("fetchImportedSkill (clawhub)", () => {
  it("downloads SKILL.md + each manifest file", async () => {
    // Order matters: more specific URLs must come first since the matcher
    // uses .includes() and stops at the first hit.
    calls.push({
      url: "file?path=SKILL.md",
      respond: () => new Response("# hello"),
    });
    calls.push({
      url: "file?path=extra.md",
      respond: () => new Response("more"),
    });
    calls.push({
      url: "/api/v1/skills/demo/versions/1",
      respond: () =>
        new Response(
          JSON.stringify({
            version: {
              version: "1",
              files: [
                { path: "SKILL.md", size: 5 },
                { path: "extra.md", size: 3 },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    calls.push({
      url: "/api/v1/skills/demo",
      respond: () =>
        new Response(
          JSON.stringify({
            skill: { slug: "demo", displayName: "Demo", summary: "S" },
            latestVersion: { version: "1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    const out = await fetchImportedSkill("https://clawhub.ai/me/demo");
    expect(out.name).toBe("Demo");
    expect(out.description).toBe("S");
    expect(out.content).toBe("# hello");
    expect(out.files).toEqual([{ path: "extra.md", content: "more" }]);
  });
});

describe("fetchImportedSkill (skills.sh)", () => {
  it("fetches SKILL.md and directory contents from GitHub", async () => {
    calls.push({
      url: "api.github.com/repos/owner/repo",
      respond: (req) => {
        const u = new URL(req.url);
        // Match the bare repo metadata call (no /contents/)
        if (u.pathname === "/repos/owner/repo") {
          return new Response(JSON.stringify({ default_branch: "main" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        // Directory contents call
        if (u.pathname.startsWith("/repos/owner/repo/contents/")) {
          return new Response(
            JSON.stringify([
              {
                name: "SKILL.md",
                path: "skills/demo/SKILL.md",
                type: "file",
                download_url: "https://raw.example/SKILL.md",
                url: "https://api.github.com/x/SKILL.md",
              },
              {
                name: "helper.sh",
                path: "skills/demo/helper.sh",
                type: "file",
                download_url: "https://raw.example/helper.sh",
                url: "https://api.github.com/x/helper.sh",
              },
              {
                name: "LICENSE",
                path: "skills/demo/LICENSE",
                type: "file",
                download_url: "https://raw.example/LICENSE",
                url: "https://api.github.com/x/LICENSE",
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    calls.push({
      url: "raw.githubusercontent.com/owner/repo/main/skills/demo/SKILL.md",
      respond: () => new Response("---\nname: Demo\ndescription: a demo skill\n---\n# body"),
    });
    calls.push({
      url: "raw.example/helper.sh",
      respond: () => new Response("echo hi"),
    });

    const out = await fetchImportedSkill("https://skills.sh/owner/repo/demo");
    expect(out.name).toBe("Demo");
    expect(out.description).toBe("a demo skill");
    expect(out.content).toContain("# body");
    expect(out.files).toEqual([{ path: "helper.sh", content: "echo hi" }]);
  });

  it("rejects malformed skills.sh URLs", async () => {
    await expect(fetchImportedSkill("https://skills.sh/owner/repo")).rejects.toThrow(
      /expected URL/,
    );
  });
});

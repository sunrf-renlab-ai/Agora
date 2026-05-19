import { describe, expect, it } from "bun:test";
import { buildClaudeMd } from "./runtime-config";

describe("buildClaudeMd", () => {
  it("always includes Agent Runtime header and Available Commands", () => {
    const md = buildClaudeMd({});
    expect(md).toContain("# Agora Agent Runtime");
    expect(md).toContain("## Available Commands");
    expect(md).toContain("agora issue get");
    expect(md).toContain("agora issue comment add");
    expect(md).toContain("--content-stdin");
  });

  it("emits Agent Identity when agent fields are provided", () => {
    const md = buildClaudeMd({
      agentName: "Reviewer",
      agentId: "agent-1",
      agentInstructions: "You critique pull requests like a senior eng.",
    });
    expect(md).toContain("## Agent Identity");
    expect(md).toContain("**You are: Reviewer**");
    expect(md).toContain("(ID: `agent-1`)");
    expect(md).toContain("You critique pull requests like a senior eng.");
  });

  it("omits Agent Identity when no agent fields are present", () => {
    const md = buildClaudeMd({});
    expect(md).not.toContain("## Agent Identity");
  });

  it("emits Repositories section only when repos are present", () => {
    const without = buildClaudeMd({});
    expect(without).not.toContain("## Repositories");

    const withRepos = buildClaudeMd({
      repos: [{ url: "https://github.com/example/foo" }, { url: "https://github.com/example/bar" }],
    });
    expect(withRepos).toContain("## Repositories");
    expect(withRepos).toContain("https://github.com/example/foo");
    expect(withRepos).toContain("https://github.com/example/bar");
  });

  it("emits Project Context when projectId or resources are present", () => {
    const md = buildClaudeMd({
      projectId: "proj-1",
      projectTitle: "Q3 Roadmap",
      projectResources: [
        { resourceType: "repo", resourceRef: "https://github.com/example/foo" },
        { resourceType: "url", resourceRef: "https://docs.example.com/spec", label: "Spec" },
      ],
    });
    expect(md).toContain("## Project Context");
    expect(md).toContain("Q3 Roadmap");
    expect(md).toContain("https://github.com/example/foo");
    expect(md).toContain("**URL**");
    expect(md).toContain("Spec");
  });

  it("omits Project Context entirely when neither projectId nor resources", () => {
    const md = buildClaudeMd({});
    expect(md).not.toContain("## Project Context");
  });

  it("lists skills when agentSkills is non-empty", () => {
    const md = buildClaudeMd({
      agentSkills: [{ name: "review" }, { name: "qa" }],
    });
    expect(md).toContain("## Skills");
    expect(md).toContain("**review**");
    expect(md).toContain("**qa**");
    expect(md).toContain(".claude/skills/");
  });

  it("uses chat workflow branch for chat tasks", () => {
    const md = buildClaudeMd({ chatSessionId: "chat-1" });
    expect(md).toContain("## Workflow");
    expect(md).toContain("chat mode");
    // Chat workflow shouldn't prescribe issue-state transitions.
    const workflow = md.split("## Workflow")[1]?.split("##")[0] ?? "";
    expect(workflow).not.toContain("agora issue status");
  });

  it("uses quick-create workflow branch", () => {
    const md = buildClaudeMd({ quickCreatePrompt: "fix the login bug" });
    expect(md).toContain("quick-create");
    expect(md).toContain("Run exactly one `agora issue create`");
  });

  it("uses autopilot workflow branch and Output rule", () => {
    const md = buildClaudeMd({
      autopilotRunId: "run-1",
      autopilotId: "ap-1",
      autopilotTitle: "Nightly summary",
      autopilotDescription: "Summarize what shipped today.",
      autopilotSource: "schedule",
    });
    expect(md).toContain("run-only mode");
    expect(md).toContain("run-1");
    expect(md).toContain("Nightly summary");
    expect(md).toContain("Summarize what shipped today.");
    // Output rule for autopilot says final assistant output is captured.
    expect(md).toContain("autopilot run result");
  });

  it("uses comment-trigger workflow branch + i18n line in Output", () => {
    const md = buildClaudeMd({
      issueId: "i-1",
      triggerCommentId: "c-1",
    });
    expect(md).toContain("triggered by a NEW comment");
    expect(md).toContain("agora issue get i-1");
    expect(md).toContain("c-1");
    // Spec: i18n line on comment-trigger Output.
    expect(md).toContain("language of the triggering comment");
  });

  it("uses assignment workflow branch when only issueId is set", () => {
    const md = buildClaudeMd({ issueId: "i-1" });
    expect(md).toContain("assigned to an issue");
    expect(md).toContain("agora issue get i-1");
    // Spec: no fixed in_progress/done flow.
    expect(md).not.toMatch(/Run `agora issue status i-1 in_progress`/);
    // i18n line in Output applies to assignment too per spec.
    expect(md).toContain("language of the triggering comment");
  });

  it("includes Mentions, Attachments, Always-Use-CLI sections", () => {
    const md = buildClaudeMd({});
    expect(md).toContain("## Mentions");
    expect(md).toContain("mention://issue/");
    expect(md).toContain("## Attachments");
    expect(md).toContain("agora attachment download");
    expect(md).toContain("## Important: Always Use the `agora` CLI");
  });

  it("renders Team Agents roster with capability + availability signals", () => {
    const md = buildClaudeMd({
      teamAgents: [
        {
          id: "a-1",
          name: "QA Bot",
          description: "Runs regression tests",
          instructions: "When asked to verify a fix, always re-run the failing test first.",
          cliKind: "claude_code",
          model: "claude-opus-4-7",
          ownerId: "u-1",
          skills: ["run-e2e", "deploy-vercel"],
          mcpServers: ["linear", "postgres-prod"],
          runtimeOnline: true,
          loadActive: 1,
          loadCap: 3,
        },
        {
          id: "a-2",
          name: "Doc Writer",
          description: "",
          instructions: "",
          cliKind: "gemini",
          model: null,
          ownerId: null,
          skills: [],
          mcpServers: [],
          runtimeOnline: false,
          loadActive: 0,
          loadCap: 1,
        },
      ],
    });
    expect(md).toContain("## Team Agents");
    expect(md).toContain("QA Bot");
    expect(md).toContain("`a-1`");
    expect(md).toContain("Runs regression tests");
    expect(md).toContain("re-run the failing test");
    expect(md).toContain("claude_code · claude-opus-4-7 · owner `u-1`");
    // Capability + availability signals
    expect(md).toContain("Status: online · load 1/3");
    expect(md).toContain("Skills: deploy-vercel, run-e2e"); // sorted in server enrichment
    expect(md).toContain("MCP:    linear, postgres-prod");
    // Doc Writer (offline + empty everything) still rendered
    expect(md).toContain("Doc Writer");
    expect(md).toContain("**offline**");
    expect(md).toContain("(no description)");
    expect(md).toContain("Skills: _(none — generic agent)_");
    expect(md).toContain("MCP:    _(none)_");
    expect(md).toContain("agora issue update");
  });

  it("flags saturated agents so the routing decision can avoid them", () => {
    const md = buildClaudeMd({
      teamAgents: [
        {
          id: "a-3",
          name: "Busy Bot",
          description: "",
          instructions: "",
          cliKind: "claude_code",
          model: null,
          ownerId: null,
          skills: [],
          mcpServers: [],
          runtimeOnline: true,
          loadActive: 3,
          loadCap: 3,
        },
      ],
    });
    expect(md).toContain("Status: online · load 3/3 · **saturated**");
  });

  it("omits the Team Agents section entirely when no teammates", () => {
    const md = buildClaudeMd({});
    expect(md).not.toContain("## Team Agents");
  });

  it("caps Team Agents at the global byte budget and notes the remainder", () => {
    const big = "x".repeat(450);
    const agents = Array.from({ length: 30 }, (_, i) => ({
      id: `a-${i}`,
      name: `Agent ${i}`,
      description: big,
      instructions: big,
      cliKind: "claude_code",
      model: null,
      ownerId: null,
      skills: [],
      mcpServers: [],
      runtimeOnline: true,
      loadActive: 0,
      loadCap: 1,
    }));
    const md = buildClaudeMd({ teamAgents: agents });
    expect(md).toContain("## Team Agents");
    expect(md).toMatch(/and \d+ more — list with `agora agent list/);
  });

  it("includes Sediment what you learned section with both triggers", () => {
    const md = buildClaudeMd({});
    expect(md).toContain("## Sediment what you learned");
    expect(md).toContain("SKILL.md");
    // Two trigger mechanisms must both be in the prompt:
    // 1. Completed reusable / complex work
    // 2. Climbed out of a pit (trap-and-escape lesson)
    expect(md).toContain("completed something reusable");
    expect(md).toContain("hit a pit and climbed out");
  });
});

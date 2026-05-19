import { describe, expect, it } from "bun:test";
import { buildPrompt } from "./prompts";

const baseAgent = {
  id: "a",
  name: "n",
  cliKind: "claude_code",
  model: null,
  customEnv: {},
  customArgs: [],
  mcpConfig: {},
  instructions: "You are helpful.",
  promptTemplates: {},
};

const baseTaskFields = {
  triggerSummary: null,
  quickCreatePrompt: null,
  chatPrompt: null,
  originType: null,
  priorSession: null,
  triggerComment: null,
  attempt: 1,
  parentTaskId: null,
  autopilotRunId: null,
  autopilotId: null,
  autopilotTitle: null,
  autopilotDescription: null,
  autopilotSource: null,
  autopilotTriggerPayload: null,
} as const;

describe("buildPrompt", () => {
  it("uses chatPrompt when task is a chat task", () => {
    const out = buildPrompt(
      {
        id: "t",
        workspaceId: "w",
        agentId: "a",
        issueId: null,
        chatSessionId: "s",
        triggerCommentId: null,
        ...baseTaskFields,
        chatPrompt: "User: hi\n\nAgent: hello\n\nUser: how are you?",
      },
      baseAgent,
      null,
    );
    expect(out).toContain("User: how are you?");
    expect(out).not.toContain("Your assigned issue ID");
  });

  it("issue prompt is now thin — defers workflow to CLAUDE.md", () => {
    const out = buildPrompt(
      {
        id: "t",
        workspaceId: "w",
        agentId: "a",
        issueId: "i",
        chatSessionId: null,
        triggerCommentId: null,
        ...baseTaskFields,
      },
      baseAgent,
      { id: "i", identifier: "I-1", title: "Do thing", description: "details" },
    );
    expect(out).toContain("Your assigned issue ID is: i");
    expect(out).toContain("agora issue get i --output json");
    // The slimmed prompt no longer prescribes a 5-step in_progress/done
    // workflow — that lives in CLAUDE.md now.
    expect(out).not.toContain("agora issue status i in_progress");
    expect(out).not.toContain("agora issue status i done");
    // And the per-agent instructions header has moved out of the prompt.
    expect(out).not.toContain("You are helpful.");
  });

  it("uses quick-create prompt when task carries quickCreatePrompt", () => {
    const out = buildPrompt(
      {
        id: "t",
        workspaceId: "w",
        agentId: "a",
        issueId: null,
        chatSessionId: null,
        triggerCommentId: null,
        ...baseTaskFields,
        quickCreatePrompt: "fix the login bug",
        originType: "quick_create",
      },
      baseAgent,
      null,
    );
    expect(out).toContain("quick-create assistant");
    expect(out).toContain("fix the login bug");
    expect(out).toContain("agora issue create");
    expect(out).toContain(`--assignee-id ${baseAgent.id}`);
    expect(out).toContain("Do NOT browse the local filesystem");
  });

  it("routes to comment prompt when triggerComment is set", () => {
    const out = buildPrompt(
      {
        id: "t",
        workspaceId: "w",
        agentId: "a",
        issueId: "i",
        chatSessionId: null,
        triggerCommentId: "c1",
        ...baseTaskFields,
        triggerSummary: "mentioned in comment",
        triggerComment: {
          id: "c1",
          content: "Hey @agent, can you take a look at the auth flow?",
          authorKind: "member",
          authorName: "Alice",
          createdAt: "2026-05-09T10:00:00Z",
        },
      },
      baseAgent,
      { id: "i", identifier: "I-1", title: "Do thing", description: "details" },
    );
    expect(out).toContain("[NEW COMMENT]");
    expect(out).toContain("Hey @agent, can you take a look at the auth flow?");
    expect(out).toContain("Alice");
    expect(out).toContain("agora issue comment add i --parent c1 --content-stdin");
    expect(out).toContain("<<'COMMENT'");
    expect(out).toContain("do NOT reuse --parent");
    // No fallthrough to the assignment-trigger workflow.
    expect(out).not.toContain("agora issue status i in_progress");
  });

  it("comment prompt flags an agent author for silence-by-default", () => {
    const out = buildPrompt(
      {
        id: "t",
        workspaceId: "w",
        agentId: "a",
        issueId: "i",
        chatSessionId: null,
        triggerCommentId: "c2",
        ...baseTaskFields,
        triggerComment: {
          id: "c2",
          content: "Thanks!",
          authorKind: "agent",
          authorName: "GPT-Boy",
          createdAt: "2026-05-09T10:01:00Z",
        },
      },
      baseAgent,
      { id: "i", identifier: "I-1", title: "Do thing", description: "details" },
    );
    expect(out).toContain("Another agent (GPT-Boy)");
    expect(out).toContain("Silence");
  });

  it("uses agent.promptTemplates.issue when set, with issue + agent + attempt context", () => {
    const out = buildPrompt(
      {
        id: "t",
        workspaceId: "w",
        agentId: "a",
        issueId: "i",
        chatSessionId: null,
        triggerCommentId: null,
        ...baseTaskFields,
        attempt: 3,
        priorSession: { session_id: "sess-1", work_dir: "/tmp/x" },
      },
      {
        ...baseAgent,
        promptTemplates: {
          issue: [
            "Issue {{ issue.identifier }} for {{ agent.name }}",
            "{% if attempt %}retry #{{ attempt }} (continuation={{ continuation }}){% endif %}",
          ].join("\n"),
        },
      },
      { id: "i", identifier: "I-7", title: "Do thing", description: null },
    );
    expect(out).toContain("Issue I-7 for n");
    expect(out).toContain("retry #3 (continuation=true)");
    // The legacy hardcoded "Your assigned issue ID is" header MUST NOT leak
    // through when a template is set — that would mean both ran.
    expect(out).not.toContain("Your assigned issue ID is");
  });

  it("falls back to legacy builder when promptTemplates does not have a matching key", () => {
    const out = buildPrompt(
      {
        id: "t",
        workspaceId: "w",
        agentId: "a",
        issueId: "i",
        chatSessionId: null,
        triggerCommentId: null,
        ...baseTaskFields,
      },
      { ...baseAgent, promptTemplates: { chat: "ignored — wrong kind" } },
      { id: "i", identifier: "I-1", title: "Do thing", description: null },
    );
    expect(out).toContain("Your assigned issue ID is: i");
  });

  it("uses autopilot prompt for run-only autopilot tasks (no issueId)", () => {
    const out = buildPrompt(
      {
        id: "t",
        workspaceId: "w",
        agentId: "a",
        issueId: null,
        chatSessionId: null,
        triggerCommentId: null,
        ...baseTaskFields,
        originType: "autopilot",
        autopilotRunId: "run-1",
        autopilotId: "ap-1",
        autopilotTitle: "Nightly summary",
        autopilotDescription: "Summarize what shipped today.",
        autopilotSource: "schedule",
      },
      baseAgent,
      null,
    );
    expect(out).toContain("Autopilot");
    expect(out).toContain("run-only mode");
    expect(out).toContain("run-1");
    expect(out).toContain("Nightly summary");
    expect(out).toContain("Summarize what shipped today.");
    expect(out).toContain("Do not run `agora issue get`");
  });
});

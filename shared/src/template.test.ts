import { describe, expect, it } from "bun:test";
import { PromptRenderError, renderPrompt } from "./template";

const baseCtx = {
  agent: {
    id: "a1",
    name: "Coder",
    instructions: "be careful",
    model: null,
    cliKind: "claude_code",
  },
  task: { id: "t1", attempt: 1, originType: null, parentTaskId: null },
  attempt: null,
  continuation: false,
} as const;

describe("renderPrompt", () => {
  it("renders simple variable substitution", () => {
    const out = renderPrompt("Hello {{ agent.name }}", { ...baseCtx });
    expect(out).toBe("Hello Coder");
  });

  it("renders issue context fields", () => {
    const out = renderPrompt("Issue {{ issue.identifier }}: {{ issue.title }}", {
      ...baseCtx,
      issue: {
        id: "i1",
        identifier: "AGO-7",
        title: "fix login",
        description: null,
        status: "in_progress",
        priority: null,
        labels: [],
        url: null,
        branchName: null,
      },
    });
    expect(out).toBe("Issue AGO-7: fix login");
  });

  it("supports if/else for continuation vs first run", () => {
    const tpl = "{% if continuation %}continue{% else %}start{% endif %}";
    expect(renderPrompt(tpl, { ...baseCtx, continuation: false })).toBe("start");
    expect(renderPrompt(tpl, { ...baseCtx, continuation: true })).toBe("continue");
  });

  it("iterates labels", () => {
    const tpl = "labels: {% for l in issue.labels %}{{ l }} {% endfor %}";
    const out = renderPrompt(tpl, {
      ...baseCtx,
      issue: {
        id: "i1",
        identifier: null,
        title: "x",
        description: null,
        status: "todo",
        priority: null,
        labels: ["bug", "p0"],
        url: null,
        branchName: null,
      },
    });
    expect(out.trim()).toBe("labels: bug p0");
  });

  it("throws PromptRenderError on unknown variable (strict mode)", () => {
    expect(() => renderPrompt("Hello {{ nonexistent.field }}", { ...baseCtx })).toThrow(
      PromptRenderError,
    );
  });

  it("throws PromptRenderError on unknown filter", () => {
    expect(() => renderPrompt("{{ agent.name | not_a_real_filter }}", { ...baseCtx })).toThrow(
      PromptRenderError,
    );
  });

  it("throws PromptRenderError on parse error", () => {
    expect(() => renderPrompt("{% if no_endif %}", { ...baseCtx })).toThrow(PromptRenderError);
  });

  it("renders attempt/lastError block on retry", () => {
    const tpl = [
      "{% if attempt %}",
      "Retry #{{ attempt }} after {{ lastError.kind }}: {{ lastError.message }}",
      "{% else %}",
      "First run",
      "{% endif %}",
    ].join("\n");
    const out = renderPrompt(tpl, {
      ...baseCtx,
      attempt: 2,
      lastError: { kind: "turn_timeout", message: "timed out" },
    });
    expect(out).toContain("Retry #2 after turn_timeout: timed out");
  });
});

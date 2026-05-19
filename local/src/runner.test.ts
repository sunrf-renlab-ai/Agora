import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeRunner, extractClaudeUsage, pickRunner } from "./runner";

describe("pickRunner", () => {
  it("returns a runner for every supported cliKind", () => {
    for (const k of ["claude_code", "codex", "gemini", "openclaw", "hermes"] as const) {
      expect(typeof pickRunner(k).run).toBe("function");
    }
  });
  it("throws for unknown cliKind", () => {
    expect(() => pickRunner("nonsense")).toThrow();
  });
});

describe("extractClaudeUsage", () => {
  it("normalizes the Claude Code JSON tail into camelCase RunUsage", () => {
    const u = extractClaudeUsage({
      session_id: "s",
      result: "ok",
      usage: {
        input_tokens: 1234,
        output_tokens: 567,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50,
      },
      total_cost_usd: 0.0123,
      duration_ms: 4567,
      num_turns: 3,
      model_id: "claude-sonnet-4-6",
    });
    expect(u).toEqual({
      inputTokens: 1234,
      outputTokens: 567,
      cacheReadTokens: 100,
      cacheCreationTokens: 50,
      totalCostUsd: 0.0123,
      durationMs: 4567,
      numTurns: 3,
      model: "claude-sonnet-4-6",
    });
  });

  it("returns nulls for missing fields, doesn't throw", () => {
    expect(extractClaudeUsage({})).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      totalCostUsd: null,
      durationMs: null,
      numTurns: null,
      model: null,
    });
  });

  it("falls back to model when model_id missing", () => {
    const u = extractClaudeUsage({ model: "claude-haiku-4-5" });
    expect(u.model).toBe("claude-haiku-4-5");
  });
});

describe("ClaudeCodeRunner workspace invariant", () => {
  const baseArgs = {
    cliKind: "claude_code",
    taskId: "11111111-1111-1111-1111-111111111111",
    agentId: "agent-id",
    workspaceId: "ws-id",
    serverUrl: "http://localhost",
    taskToken: "tok",
    prompt: "hi",
    priorSessionId: null,
    customEnv: {},
    customArgs: [],
    model: null,
  };

  it("rejects priorWorkDir outside AGORA_WORKDIR_ROOT", async () => {
    const root = await mkdtemp(join(tmpdir(), "agora-root-"));
    const outside = await mkdtemp(join(tmpdir(), "agora-outside-"));
    const prevRoot = process.env.AGORA_WORKDIR_ROOT;
    process.env.AGORA_WORKDIR_ROOT = root;
    try {
      const runner = new ClaudeCodeRunner();
      await expect(
        runner.run({ ...baseArgs, priorWorkDir: outside } as Parameters<typeof runner.run>[0]),
      ).rejects.toThrow(/workspace_invariant_violation/);
    } finally {
      if (prevRoot === undefined) {
        process.env.AGORA_WORKDIR_ROOT = undefined;
      } else {
        process.env.AGORA_WORKDIR_ROOT = prevRoot;
      }
    }
  });
});

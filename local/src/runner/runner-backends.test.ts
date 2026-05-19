// Smoke tests for the 5 ported backends. We don't spawn real subprocesses
// here — those are integration tests. We validate the pieces that are
// pure-functional and easy to assert on: arg builders, blocked-args
// filters, ACP title→tool mapping, the ACP provider-error sniffer, and
// the NDJSON line splitter.

import { describe, expect, it } from "bun:test";

import { filterCustomArgs } from "./blocked-args";
import { buildClaudeArgs, buildClaudeInput, claudeBlockedArgs, resolveSessionId } from "./claude";
import { buildCodexArgs, codexBlockedArgs } from "./codex";
import { buildGeminiArgs, geminiBlockedArgs } from "./gemini";
import { ACPProviderErrorSniffer, hermesBlockedArgs, hermesToolNameFromTitle } from "./hermes";
import { readNdjson } from "./ndjson";
import { buildOpenclawArgs, openclawBlockedArgs } from "./openclaw";

describe("filterCustomArgs", () => {
  it("drops standalone blocked flags", () => {
    expect(filterCustomArgs(["--keep", "--yolo"], { "--yolo": "standalone" })).toEqual(["--keep"]);
  });
  it("drops with-value flags AND their value", () => {
    expect(
      filterCustomArgs(["--keep", "--model", "x", "--also-keep"], { "--model": "with-value" }),
    ).toEqual(["--keep", "--also-keep"]);
  });
  it("drops --flag=value form too", () => {
    expect(filterCustomArgs(["--keep", "--model=x"], { "--model": "with-value" })).toEqual([
      "--keep",
    ]);
  });
});

describe("buildClaudeArgs", () => {
  it("starts with the protocol-critical flags", () => {
    const args = buildClaudeArgs({ cwd: "/tmp" });
    expect(args.slice(0, 9)).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--strict-mcp-config",
      "--permission-mode",
      "bypassPermissions",
    ]);
  });
  it("adds --model / --max-turns / --append-system-prompt / --resume", () => {
    const args = buildClaudeArgs({
      cwd: "/tmp",
      model: "claude-opus-4-7",
      maxTurns: 5,
      systemPrompt: "be brief",
      resumeSessionId: "sess-1",
    });
    expect(args).toContain("--model");
    expect(args).toContain("claude-opus-4-7");
    expect(args).toContain("--max-turns");
    expect(args).toContain("5");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("be brief");
    expect(args).toContain("--resume");
    expect(args).toContain("sess-1");
  });
  it("filters protocol-critical flags from customArgs", () => {
    const args = buildClaudeArgs({
      cwd: "/tmp",
      customArgs: ["--harmless", "--output-format", "json", "--mcp-config", "x", "--keep-me"],
    });
    expect(args).toContain("--harmless");
    expect(args).toContain("--keep-me");
    // Hardcoded defaults remain; user attempt to override is dropped.
    const formatIdxs = args.reduce<number[]>(
      (acc, v, i) => (v === "--output-format" ? [...acc, i] : acc),
      [],
    );
    expect(formatIdxs).toHaveLength(1); // only the daemon-set one
  });
});

describe("buildClaudeInput", () => {
  it("wraps prompt in stream-json user envelope", () => {
    const out = JSON.parse(buildClaudeInput("hello").trim());
    expect(out.type).toBe("user");
    expect(out.message.role).toBe("user");
    expect(out.message.content[0].type).toBe("text");
    expect(out.message.content[0].text).toBe("hello");
  });
});

describe("resolveSessionId", () => {
  it("returns emitted when no resume requested", () => {
    expect(resolveSessionId(null, "fresh", false)).toBe("fresh");
  });
  it("returns emitted on success even if it changed", () => {
    expect(resolveSessionId("old", "new", false)).toBe("new");
  });
  it("clears emitted when resume failed AND id changed (so daemon falls back)", () => {
    expect(resolveSessionId("old", "new", true)).toBe("");
  });
  it("preserves emitted when resume failed but id matches the request", () => {
    expect(resolveSessionId("old", "old", true)).toBe("old");
  });
});

describe("buildGeminiArgs", () => {
  it("produces the expected geminiBackend.buildGeminiArgs shape", () => {
    const args = buildGeminiArgs("hi", {
      cwd: "/tmp",
      model: "gemini-2.5-pro",
      resumeSessionId: "sess-x",
    });
    expect(args).toEqual([
      "-p",
      "hi",
      "--yolo",
      "-o",
      "stream-json",
      "-m",
      "gemini-2.5-pro",
      "-r",
      "sess-x",
    ]);
  });
});

describe("buildCodexArgs", () => {
  it("starts with app-server --listen stdio://", () => {
    expect(buildCodexArgs({ cwd: "/tmp" }).slice(0, 3)).toEqual([
      "app-server",
      "--listen",
      "stdio://",
    ]);
  });
});

describe("buildOpenclawArgs", () => {
  it("ends with --message and prepends agora-prefixed session id", () => {
    const args = buildOpenclawArgs("write a poem", "agora-12345", { cwd: "/tmp" });
    expect(args[0]).toBe("agent");
    expect(args).toContain("--local");
    expect(args).toContain("--json");
    expect(args).toContain("--session-id");
    expect(args).toContain("agora-12345");
    expect(args[args.length - 2]).toBe("--message");
    expect(args[args.length - 1]).toBe("write a poem");
  });
  it("prepends systemPrompt to the message inline (openclaw rejects --system-prompt)", () => {
    const args = buildOpenclawArgs("body", "s", {
      cwd: "/tmp",
      systemPrompt: "be terse",
    });
    expect(args[args.length - 1]).toBe("be terse\n\nbody");
  });
  it("injects --agent <model> only when customArgs doesn't already set it", () => {
    const withModel = buildOpenclawArgs("p", "s", { cwd: "/tmp", model: "deepseek-chat" });
    expect(withModel).toContain("--agent");
    expect(withModel).toContain("deepseek-chat");
    const userOverride = buildOpenclawArgs("p", "s", {
      cwd: "/tmp",
      model: "deepseek-chat",
      customArgs: ["--agent", "custom"],
    });
    // user wins
    const idx = userOverride.indexOf("--agent");
    expect(userOverride[idx + 1]).toBe("custom");
  });
});

describe("hermesToolNameFromTitle", () => {
  it("maps common ACP title prefixes back to tool names", () => {
    expect(hermesToolNameFromTitle("read: /path/to/file", "")).toBe("read_file");
    expect(hermesToolNameFromTitle("write: /path", "")).toBe("write_file");
    expect(hermesToolNameFromTitle("terminal: ls -la", "")).toBe("terminal");
    expect(hermesToolNameFromTitle("patch (replace): foo.go", "")).toBe("patch");
    expect(hermesToolNameFromTitle("execute code", "")).toBe("execute_code");
    expect(hermesToolNameFromTitle("web search: anthropic", "")).toBe("web_search");
  });
  it("falls back to kind when title has no colon", () => {
    expect(hermesToolNameFromTitle("", "read")).toBe("read_file");
    expect(hermesToolNameFromTitle("", "edit")).toBe("write_file");
    expect(hermesToolNameFromTitle("", "execute")).toBe("terminal");
    expect(hermesToolNameFromTitle("", "fetch")).toBe("web_search");
  });
  it("preserves non-empty bare title (kimi case)", () => {
    expect(hermesToolNameFromTitle("Shell", "")).toBe("Shell");
  });
});

describe("ACPProviderErrorSniffer", () => {
  it("captures HTTP 400 lines and surfaces the most useful detail", () => {
    const s = new ACPProviderErrorSniffer("hermes");
    s.write(
      "⚠️ API call failed (attempt 1/3): BadRequestError [HTTP 400]\nError: HTTP 400: model not supported\n",
    );
    expect(s.message()).toBe("hermes provider error: HTTP 400: model not supported");
  });
  it("returns empty when nothing matches", () => {
    const s = new ACPProviderErrorSniffer("hermes");
    s.write("just some chatter\nfine\n");
    expect(s.message()).toBe("");
  });
  it("dedupes repeated identical lines", () => {
    const s = new ACPProviderErrorSniffer("hermes");
    s.write("⚠️ HTTP 429 rate limit\n⚠️ HTTP 429 rate limit\n⚠️ HTTP 429 rate limit\n");
    expect(s.message()).toBe("hermes provider error: ⚠️ HTTP 429 rate limit");
  });
});

describe("blocked-args definitions", () => {
  it("claudeBlockedArgs covers the protocol-critical flags", () => {
    expect(claudeBlockedArgs["-p"]).toBe("standalone");
    expect(claudeBlockedArgs["--output-format"]).toBe("with-value");
    expect(claudeBlockedArgs["--input-format"]).toBe("with-value");
    expect(claudeBlockedArgs["--permission-mode"]).toBe("with-value");
    expect(claudeBlockedArgs["--mcp-config"]).toBe("with-value");
  });
  it("codexBlockedArgs blocks --listen", () => {
    expect(codexBlockedArgs["--listen"]).toBe("with-value");
  });
  it("geminiBlockedArgs blocks -p / --yolo / -o", () => {
    expect(geminiBlockedArgs["-p"]).toBe("with-value");
    expect(geminiBlockedArgs["--yolo"]).toBe("standalone");
    expect(geminiBlockedArgs["-o"]).toBe("with-value");
  });
  it("openclawBlockedArgs blocks the daemon-managed args", () => {
    expect(openclawBlockedArgs["--local"]).toBe("standalone");
    expect(openclawBlockedArgs["--json"]).toBe("standalone");
    expect(openclawBlockedArgs["--session-id"]).toBe("with-value");
    expect(openclawBlockedArgs["--message"]).toBe("with-value");
  });
  it("hermesBlockedArgs blocks `acp`", () => {
    expect(hermesBlockedArgs.acp).toBe("standalone");
  });
});

describe("readNdjson", () => {
  it("yields one parsed JSON value per line", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('{"a":1}\n{"b":2}\n'));
        controller.enqueue(enc.encode('{"c":3}\n'));
        controller.close();
      },
    });
    const out: unknown[] = [];
    for await (const v of readNdjson<unknown>(stream)) out.push(v);
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
  it("skips lines that don't parse as JSON", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('{"ok":true}\nnot-json\n{"also":"ok"}\n'));
        controller.close();
      },
    });
    const out: unknown[] = [];
    for await (const v of readNdjson<unknown>(stream)) out.push(v);
    expect(out).toEqual([{ ok: true }, { also: "ok" }]);
  });
});

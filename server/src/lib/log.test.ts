import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { log } from "./log";

let stdoutLines: string[] = [];
let stderrLines: string[] = [];
let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
  stdoutLines = [];
  stderrLines = [];
  originalLog = console.log;
  originalError = console.error;
  console.log = ((...args: unknown[]) => {
    stdoutLines.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  }) as typeof console.log;
  console.error = ((...args: unknown[]) => {
    stderrLines.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  }) as typeof console.error;
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

function firstParsed(lines: string[]): Record<string, unknown> {
  const line = lines[0];
  if (line === undefined) throw new Error("expected at least one line captured");
  return JSON.parse(line) as Record<string, unknown>;
}

describe("log", () => {
  it("emits one JSON line per info call with level/msg/ts/fields", () => {
    log.info("server.listen", { port: 8080 });
    expect(stdoutLines).toHaveLength(1);
    expect(stderrLines).toHaveLength(0);
    const parsed = firstParsed(stdoutLines);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("server.listen");
    expect(parsed.port).toBe(8080);
    expect(typeof parsed.ts).toBe("string");
    expect(Number.isFinite(Date.parse(parsed.ts as string))).toBe(true);
  });

  it("emits debug to stdout", () => {
    log.debug("trace", { step: 1 });
    expect(stdoutLines).toHaveLength(1);
    expect(stderrLines).toHaveLength(0);
    const parsed = firstParsed(stdoutLines);
    expect(parsed.level).toBe("debug");
    expect(parsed.msg).toBe("trace");
    expect(parsed.step).toBe(1);
  });

  it("routes warn to stderr", () => {
    log.warn("oops", { x: 1 });
    expect(stdoutLines).toHaveLength(0);
    expect(stderrLines).toHaveLength(1);
    const parsed = firstParsed(stderrLines);
    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("oops");
    expect(parsed.x).toBe(1);
  });

  it("routes error to stderr", () => {
    log.error("bad", { e: "boom" });
    expect(stdoutLines).toHaveLength(0);
    expect(stderrLines).toHaveLength(1);
    const parsed = firstParsed(stderrLines);
    expect(parsed.level).toBe("error");
    expect(parsed.msg).toBe("bad");
    expect(parsed.e).toBe("boom");
  });

  it("works without fields", () => {
    log.info("ping");
    expect(stdoutLines).toHaveLength(1);
    const parsed = firstParsed(stdoutLines);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("ping");
    expect(typeof parsed.ts).toBe("string");
  });

  it("includes user-provided fields alongside the standard envelope", () => {
    log.info("evt", { custom: true, n: 42 });
    const parsed = firstParsed(stdoutLines);
    expect(parsed.custom).toBe(true);
    expect(parsed.n).toBe(42);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("evt");
  });
});

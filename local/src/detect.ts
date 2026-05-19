import { spawnSync } from "node:child_process";

export interface DetectedCli {
  kind: string;
  version: string;
}

const CANDIDATES: Array<{ kind: string; bin: string; flag: string[] }> = [
  { kind: "claude_code", bin: "claude", flag: ["--version"] },
  { kind: "codex", bin: "codex", flag: ["--version"] },
  { kind: "gemini", bin: "gemini", flag: ["--version"] },
  { kind: "openclaw", bin: "openclaw", flag: ["--version"] },
  { kind: "hermes", bin: "hermes", flag: ["--version"] },
];

export function detectClis(): DetectedCli[] {
  const out: DetectedCli[] = [];
  for (const c of CANDIDATES) {
    const r = spawnSync(c.bin, c.flag, { encoding: "utf8" });
    if (r.status === 0) {
      const version = (r.stdout || r.stderr || "").trim().split("\n")[0] ?? "";
      out.push({ kind: c.kind, version });
    }
  }
  return out;
}

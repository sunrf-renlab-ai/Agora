// Process spawn helper used by every backend.
// Wraps Bun.spawn with our standard piping, stderr-tail capture, and
// onSpawn/onExit lifecycle hooks. Returns a Subprocess plus a stderr tail
// reader so callers can include the tail in error messages.

import { StderrTail } from "./stderr-tail";

export interface SpawnArgs {
  cmd: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: "pipe" | "ignore" | ReadableStream<Uint8Array>;
  stdout?: "pipe" | "ignore" | "inherit";
  stderr?: "pipe" | "ignore" | "inherit";
  onSpawn?: (pid: number) => void;
  onExit?: (pid: number) => void;
  /** If true, attach a StderrTail and pipe stderr through it. */
  captureStderrTail?: boolean;
}

export interface SpawnResult {
  proc: ReturnType<typeof Bun.spawn>;
  stderrTail: StderrTail | null;
}

export function spawn(args: SpawnArgs): SpawnResult {
  const proc = Bun.spawn(args.cmd, {
    cwd: args.cwd,
    env: { ...process.env, ...(args.env ?? {}) } as Record<string, string>,
    stdin: args.stdin ?? "pipe",
    stdout: args.stdout ?? "pipe",
    stderr: args.stderr ?? "pipe",
  });
  if (typeof proc.pid === "number") {
    args.onSpawn?.(proc.pid);
    if (args.onExit) {
      // Bun's exited Promise resolves with the exit code; route to onExit.
      void proc.exited.then(() => args.onExit?.(proc.pid as number));
    }
  }

  let stderrTail: StderrTail | null = null;
  if (args.captureStderrTail && proc.stderr && typeof proc.stderr !== "number") {
    stderrTail = new StderrTail();
    void pipeStderrTail(proc.stderr as ReadableStream<Uint8Array>, stderrTail);
  }

  return { proc, stderrTail };
}

async function pipeStderrTail(
  stream: ReadableStream<Uint8Array>,
  tail: StderrTail,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value && value.length > 0) tail.write(value);
      if (done) return;
    }
  } catch {
    // Reader was closed; nothing to do.
  } finally {
    reader.releaseLock();
  }
}

/**
 * Strip CLI-set env vars that would pollute or conflict with the child.
 * Used by claude (filters CLAUDECODE*) — exposed here as a generic helper.
 */
export function filterEnv(
  env: NodeJS.ProcessEnv,
  shouldKeep: (key: string) => boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && shouldKeep(k)) out[k] = v;
  }
  return out;
}

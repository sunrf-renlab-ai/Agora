// Bounded circular tail of stderr bytes, included in error messages when an
// agent CLI exits before emitting a structured error (V8 abort, Bun panic,
// OOM). Without this all the user sees is "exit status N" with the real
// reason buried in daemon logs.

const DEFAULT_MAX_BYTES = 2048;

export class StderrTail {
  private buf: Uint8Array = new Uint8Array(0);
  private readonly max: number;
  private readonly inner?: (chunk: Uint8Array) => void;

  constructor(opts?: { max?: number; inner?: (chunk: Uint8Array) => void }) {
    this.max = opts?.max && opts.max > 0 ? opts.max : DEFAULT_MAX_BYTES;
    this.inner = opts?.inner;
  }

  write(chunk: Uint8Array): void {
    if (this.inner) this.inner(chunk);
    if (chunk.length === 0) return;
    if (chunk.length >= this.max) {
      this.buf = chunk.slice(chunk.length - this.max);
      return;
    }
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    if (merged.length > this.max) {
      this.buf = merged.slice(merged.length - this.max);
    } else {
      this.buf = merged;
    }
  }

  /** Returns trimmed UTF-8 tail; empty when nothing was written. */
  tail(): string {
    return new TextDecoder("utf-8", { fatal: false }).decode(this.buf).trim();
  }
}

export function withAgentStderr(msg: string, label: string, tail: string): string {
  if (!tail) return msg;
  return `${msg}; ${label} stderr: ${tail}`;
}

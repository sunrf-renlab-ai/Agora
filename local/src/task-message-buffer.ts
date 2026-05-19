import type { DaemonConfig } from "./config";
import type { RunnerMessage } from "./runner";

// Daemon-side message buffer policy. We POST to the server every 2 s, OR
// whenever the buffer hits 50 messages — whichever fires first. On task end
// the runner calls `flush()` and awaits before /complete /fail so the web
// never sees a "completed" task with a half-empty timeline.
export const TASK_MSG_FLUSH_INTERVAL_MS = 2_000;
export const TASK_MSG_FLUSH_THRESHOLD = 50;
// Cap each batch POST so a stuck runner can't deliver one 50k-message
// payload and OOM the server. The endpoint itself enforces 500.
export const TASK_MSG_BATCH_MAX = 200;

export interface BufferedTaskMessage {
  seq: number;
  kind: RunnerMessage["kind"];
  content: unknown;
}

// Per-task message buffer. Accumulates RunnerMessages, assigns sequential
// seq numbers, and flushes batches to /api/daemon/tasks/:taskId/messages on
// a 2 s timer OR when the buffer crosses TASK_MSG_FLUSH_THRESHOLD,
// whichever fires first. Flushes are best-effort: a failed POST keeps the
// messages buffered so the next tick / final flush retries.
export class TaskMessageBuffer {
  private buf: BufferedTaskMessage[] = [];
  private seq = 0;
  // Serializes concurrent flush attempts (timer vs. threshold-trigger vs.
  // final). Without this, the same batch could be sent twice — duplicates
  // are dropped server-side by the (task_id, seq) unique index, but holding
  // the lock keeps logs sane.
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly cfg: DaemonConfig,
    private readonly taskId: string,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, TASK_MSG_FLUSH_INTERVAL_MS);
  }

  enqueue(m: RunnerMessage): void {
    this.seq += 1;
    this.buf.push({ seq: this.seq, kind: m.kind, content: m.content });
    if (this.buf.length >= TASK_MSG_FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      // Re-enter after the prior flush settles so we don't drop messages
      // that arrived mid-flight.
      await this.flushing;
    }
    if (this.buf.length === 0) return;
    const drain = this.buf.splice(0, TASK_MSG_BATCH_MAX);
    this.flushing = (async () => {
      try {
        const res = await fetch(`${this.cfg.serverUrl}/api/daemon/tasks/${this.taskId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.cfg.machineToken}`,
          },
          body: JSON.stringify({ messages: drain }),
        });
        if (!res.ok) {
          // Server rejected — re-queue at the front so seq ordering survives
          // a transient 5xx and the next tick retries.
          this.buf.unshift(...drain);
          console.warn(`[agorad] task ${this.taskId} message flush failed: ${res.status}`);
        }
      } catch (e) {
        this.buf.unshift(...drain);
        console.warn(`[agorad] task ${this.taskId} message flush error:`, (e as Error).message);
      } finally {
        this.flushing = null;
      }
    })();
    await this.flushing;
    // If a single drain wasn't enough (more arrived during the POST, or we
    // capped at BATCH_MAX), recurse so callers awaiting flush() see the
    // buffer fully drained when we return.
    if (this.buf.length > 0) await this.flush();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

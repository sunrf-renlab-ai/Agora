import { afterEach, describe, expect, it, mock } from "bun:test";
import type { DaemonConfig } from "./config";
import type { RunnerMessage } from "./runner";
import { TASK_MSG_BATCH_MAX, TaskMessageBuffer } from "./task-message-buffer";

const cfg: DaemonConfig = {
  serverUrl: "http://test.local",
  // The remaining DaemonConfig fields aren't read by TaskMessageBuffer. We
  // satisfy the type with placeholders rather than reaching into the real
  // config loader so tests stay hermetic.
  machineToken: "test-token",
} as DaemonConfig;

const TASK_ID = "task-123";
const MSG_URL = `${cfg.serverUrl}/api/daemon/tasks/${TASK_ID}/messages`;

const realFetch = globalThis.fetch;

interface CapturedPost {
  url: string;
  body: { messages: { seq: number; kind: string; content: unknown }[] };
}

function makeMsg(content: unknown = "x"): RunnerMessage {
  return { kind: "stdout", content };
}

function captureFetch(responses: Array<{ status: number }>): CapturedPost[] {
  const captured: CapturedPost[] = [];
  let i = 0;
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? JSON.parse(init.body as string) : { messages: [] };
    captured.push({ url, body });
    const r = responses[Math.min(i, responses.length - 1)] ?? { status: 200 };
    i += 1;
    return new Response(r.status === 200 ? "{}" : "err", { status: r.status });
  }) as unknown as typeof fetch;
  return captured;
}

// Helper: TS strict-null mode flags every captured[N] access. Centralize the
// assertion + non-null read so each test body stays readable.
function post(captured: CapturedPost[], idx: number): CapturedPost {
  const p = captured[idx];
  if (!p) throw new Error(`expected captured POST #${idx}, got only ${captured.length}`);
  return p;
}

describe("TaskMessageBuffer", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("assigns sequential seq starting at 1 and flushes in order", async () => {
    const captured = captureFetch([{ status: 200 }]);
    const buf = new TaskMessageBuffer(cfg, TASK_ID);
    buf.enqueue(makeMsg("a"));
    buf.enqueue(makeMsg("b"));
    await buf.flush();

    expect(captured.length).toBe(1);
    const p0 = post(captured, 0);
    expect(p0.url).toBe(MSG_URL);
    expect(p0.body.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(p0.body.messages.map((m) => m.content)).toEqual(["a", "b"]);
  });

  it("re-queues failed batch at the front so seq order is preserved on retry", async () => {
    // First POST fails (500), second succeeds. Same seq=1 should be re-sent.
    const captured = captureFetch([{ status: 500 }, { status: 200 }]);
    // Suppress the warn during the 500 path.
    const warnSpy = mock(() => {});
    const realWarn = console.warn;
    console.warn = warnSpy as unknown as typeof console.warn;
    try {
      const buf = new TaskMessageBuffer(cfg, TASK_ID);
      buf.enqueue(makeMsg("only"));
      await buf.flush(); // 500 -> re-queues
      await buf.flush(); // 200 -> drains

      expect(captured.length).toBe(2);
      const p0 = post(captured, 0);
      const p1 = post(captured, 1);
      expect(p0.body.messages.map((m) => m.seq)).toEqual([1]);
      expect(p1.body.messages.map((m) => m.seq)).toEqual([1]);
      expect(p0.body.messages[0]?.content).toBe("only");
      expect(p1.body.messages[0]?.content).toBe("only");
    } finally {
      console.warn = realWarn;
    }
  });

  it("caps each POST at TASK_MSG_BATCH_MAX (200) and recurses", async () => {
    expect(TASK_MSG_BATCH_MAX).toBe(200);
    // Hold the first POST open so the threshold-triggered flush (fires at
    // msg 50) doesn't drain the buffer while we're still enqueuing — every
    // subsequent enqueue then accumulates behind the flush lock. Once we
    // release the gate, the recursion check inside flush() has to handle
    // ~200 pending messages in a single splice, which is exactly where the
    // BATCH_MAX cap kicks in.
    const captured: CapturedPost[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let callIdx = 0;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = init?.body ? JSON.parse(init.body as string) : { messages: [] };
      captured.push({ url, body });
      if (callIdx === 0) await firstGate;
      callIdx += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const buf = new TaskMessageBuffer(cfg, TASK_ID);
    // 251 enqueues: threshold trigger at msg 50 captures the first 50. The
    // remaining 201 stay queued behind the held fetch. After release, the
    // recursion has to splice 201 items but is capped at 200 per POST, so
    // we expect THREE POSTs: 50 (threshold), 200 (cap), 1 (remainder).
    for (let i = 0; i < 251; i++) buf.enqueue(makeMsg(`m${i}`));
    releaseFirst();
    await buf.flush();

    expect(captured.length).toBe(3);
    const p0 = post(captured, 0);
    const p1 = post(captured, 1);
    const p2 = post(captured, 2);
    expect(p0.body.messages.length).toBe(50);
    expect(p1.body.messages.length).toBe(TASK_MSG_BATCH_MAX); // 200 — the cap
    expect(p2.body.messages.length).toBe(1);
    // seq sequencing across the splits must still be monotone 1..251.
    expect(p0.body.messages[0]?.seq).toBe(1);
    expect(p0.body.messages[49]?.seq).toBe(50);
    expect(p1.body.messages[0]?.seq).toBe(51);
    expect(p1.body.messages[199]?.seq).toBe(250);
    expect(p2.body.messages[0]?.seq).toBe(251);
  });

  it("concurrent flush calls serialize and do not duplicate batches", async () => {
    const captured = captureFetch([{ status: 200 }]);
    const buf = new TaskMessageBuffer(cfg, TASK_ID);
    buf.enqueue(makeMsg("a"));
    buf.enqueue(makeMsg("b"));
    await Promise.all([buf.flush(), buf.flush(), buf.flush()]);

    expect(captured.length).toBe(1);
    const p0 = post(captured, 0);
    expect(p0.body.messages.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("stop() prevents new flush timer firing but a manual flush() still drains", async () => {
    const captured = captureFetch([{ status: 200 }]);
    const buf = new TaskMessageBuffer(cfg, TASK_ID);
    buf.start(); // arm the 2 s timer
    buf.stop(); // tear it down before it can fire
    buf.enqueue(makeMsg("post-stop"));
    await buf.flush();

    expect(captured.length).toBe(1);
    const p0 = post(captured, 0);
    expect(p0.body.messages.map((m) => m.seq)).toEqual([1]);
    expect(p0.body.messages[0]?.content).toBe("post-stop");
  });
});

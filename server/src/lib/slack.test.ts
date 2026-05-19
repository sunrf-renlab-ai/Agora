import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { members, userConnections, users, workspaces } from "../db/schema/index";
import { notifyIssueHumans } from "./escalation";
import { postSlackMessage } from "./slack";
import { _resetKeyCache, encryptToken } from "./token-crypto";

describe("postSlackMessage", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("posts to chat.postMessage and reports ok", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const ok = await postSlackMessage("xoxb-bot-token", "U123", "hello");
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://slack.com/api/chat.postMessage");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer xoxb-bot-token");
    const body = JSON.parse(String(calls[0]!.init.body)) as { channel: string; text: string };
    expect(body.channel).toBe("U123");
    expect(body.text).toBe("hello");
  });

  test("returns false when Slack reports ok:false", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ ok: false, error: "not_in_channel" }), { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await postSlackMessage("xoxb", "U1", "hi")).toBe(false);
  });

  test("never throws on a network error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await postSlackMessage("xoxb", "U1", "hi")).toBe(false);
  });
});

describe("notifyIssueHumans — Slack fan-out", () => {
  let workspaceId: string;
  let ownerId: string;
  const realFetch = globalThis.fetch;
  const ORIG_KEY = process.env.AGORA_TOKEN_ENCRYPTION_KEY;

  beforeEach(async () => {
    process.env.AGORA_TOKEN_ENCRYPTION_KEY = "slack-test-key-with-enough-entropy-32+";
    _resetKeyCache();
    const stamp = `${Date.now()}-${randomBytes(3).toString("hex")}`;
    const [owner] = await db
      .insert(users)
      .values({ email: `slk-${stamp}@x`, name: "Slack Owner" })
      .returning();
    ownerId = owner!.id;
    const [w] = await db
      .insert(workspaces)
      .values({ name: "S", slug: `s-${stamp}`, issuePrefix: "S" })
      .returning();
    workspaceId = w!.id;
    await db.insert(members).values({ workspaceId, userId: ownerId, role: "owner" });
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    process.env.AGORA_TOKEN_ENCRYPTION_KEY = ORIG_KEY;
    _resetKeyCache();
    await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${ownerId}`);
  });

  test("DMs a recipient who has a connected Slack connection", async () => {
    await db.insert(userConnections).values({
      userId: ownerId,
      kind: "slack",
      status: "connected",
      config: {
        access_token: encryptToken("xoxb-real-bot-token"),
        account_id: "U-OWNER",
      },
      connectedAt: new Date(),
    });

    const calls: Array<{ token: string; channel: string; text: string }> = [];
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = JSON.parse(String(init?.body)) as { channel: string; text: string };
      calls.push({
        token: headers.Authorization ?? "",
        channel: body.channel,
        text: body.text,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    await notifyIssueHumans({
      workspaceId,
      issueId: randomBytes(16).toString("hex"),
      type: "issue_escalated",
      severity: "action_required",
      title: "S-1 escalated",
      body: "needs a human",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.token).toBe("Bearer xoxb-real-bot-token");
    expect(calls[0]!.channel).toBe("U-OWNER");
    expect(calls[0]!.text).toContain("S-1 escalated");
  });

  test("does not DM when no recipient has Slack connected", async () => {
    let called = false;
    globalThis.fetch = mock(async () => {
      called = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    await notifyIssueHumans({
      workspaceId,
      issueId: randomBytes(16).toString("hex"),
      type: "issue_task_failed",
      severity: "attention",
      title: "S-2 task failed",
      body: null,
    });

    expect(called).toBe(false);
  });
});

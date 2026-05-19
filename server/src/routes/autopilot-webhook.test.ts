import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agents,
  autopilotTriggers,
  autopilots,
  members,
  runtimes,
  users,
  workspaces,
} from "../db/schema/index";
import { generateMachineToken } from "../lib/machine-token";
import { generateWebhookToken } from "../lib/webhook-token";
import autopilotWebhookRouter from "./autopilot-webhook";

let workspaceId: string;
let userId: string;
let triggerToken: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `wh-${Date.now()}@x`, name: "WH" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "WH", slug: `wh-${Date.now()}`, issuePrefix: "WH" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  workspaceId = w!.id;
  const [m] = await db.insert(members).values({ workspaceId, userId, role: "owner" }).returning();
  const tok = generateMachineToken();
  const [r] = await db
    .insert(runtimes)
    .values({
      workspaceId,
      // biome-ignore lint/style/noNonNullAssertion: test setup
      memberId: m!.id,
      name: "rt",
      machineTokenHash: tok.hash,
      daemonVersion: "0.0.1",
      online: true,
    })
    .returning();
  const [a] = await db
    .insert(agents)
    .values({
      workspaceId,
      name: "wh-agent",
      // biome-ignore lint/style/noNonNullAssertion: test setup
      runtimeId: r!.id,
      cliKind: "claude_code",
    })
    .returning();
  const [ap] = await db
    .insert(autopilots)
    .values({
      workspaceId,
      title: "WH Test",
      // biome-ignore lint/style/noNonNullAssertion: test setup
      assigneeId: a!.id,
      executionMode: "create_issue",
      createdByKind: "member",
      createdById: userId,
    })
    .returning();
  const wt = generateWebhookToken();
  triggerToken = wt.token;
  await db.insert(autopilotTriggers).values({
    // biome-ignore lint/style/noNonNullAssertion: test setup
    autopilotId: ap!.id,
    kind: "webhook",
    webhookTokenHash: wt.hash,
    enabled: true,
  });
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("autopilot webhook", () => {
  it("returns 401 on bogus token", async () => {
    const res = await autopilotWebhookRouter.request("/api/autopilot/webhook/awh_nope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("dispatches a run on valid token", async () => {
    const res = await autopilotWebhookRouter.request(`/api/autopilot/webhook/${triggerToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "test" }),
    });
    expect([200, 202]).toContain(res.status);
  });
});

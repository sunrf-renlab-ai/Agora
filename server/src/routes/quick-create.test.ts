import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { agentTaskQueue, agents, members, runtimes, users, workspaces } from "../db/schema/index";
import { enqueueQuickCreateTask } from "../lib/enqueue";
import { generateMachineToken } from "../lib/machine-token";
import quickCreateRouter from "./quick-create";

let workspaceId: string;
let userId: string;
let runtimeId: string;
let agentId: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `qc-${Date.now()}@x`, name: "QC" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup guarantees values
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "QC", slug: `qc-${Date.now()}`, issuePrefix: "QC" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup guarantees values
  workspaceId = w!.id;
  const [m] = await db.insert(members).values({ workspaceId, userId, role: "owner" }).returning();
  const tok = generateMachineToken();
  const [r] = await db
    .insert(runtimes)
    .values({
      workspaceId,
      // biome-ignore lint/style/noNonNullAssertion: test setup guarantees values
      memberId: m!.id,
      name: "rt",
      machineTokenHash: tok.hash,
      daemonVersion: "0.0.1",
      online: true,
    })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup guarantees values
  runtimeId = r!.id;
  const [a] = await db
    .insert(agents)
    .values({ workspaceId, name: "qc-agent", runtimeId, cliKind: "claude_code" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup guarantees values
  agentId = a!.id;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("quick-create", () => {
  it("returns 401 without auth", async () => {
    const res = await quickCreateRouter.request(
      `/api/workspaces/${workspaceId}/issues/quick-create`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, prompt: "test" }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("enqueueQuickCreateTask creates task with origin_type=quick_create", async () => {
    const created = await enqueueQuickCreateTask({
      workspaceId,
      agentId,
      runtimeId,
      prompt: "Investigate the flaky test",
      requesterId: userId,
    });
    expect(created.originType).toBe("quick_create");
    expect(created.quickCreatePrompt).toBe("Investigate the flaky test");
    // Reload to verify originId is set correctly after the update
    const [t] = await db
      .select()
      .from(agentTaskQueue)
      .where(eq(agentTaskQueue.id, created.id))
      .limit(1);
    expect(t?.originId).toBe(t?.id);
  });
});

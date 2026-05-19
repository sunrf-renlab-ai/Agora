import { beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentTaskQueue,
  agents,
  issues,
  members,
  runtimes,
  users,
  workspaces,
} from "../db/schema/index";
import { tickRuntimeMonitor } from "./runtime-monitor";

async function seed() {
  // Truncate state we touch — this monitor sweeps based on global time, so we need
  // a clean slate to assert exact counts.
  await db.execute(
    sql`TRUNCATE agent_task_queue, agent, runtime, member, "user", workspace RESTART IDENTITY CASCADE`,
  );
  const [ws] = await db
    .insert(workspaces)
    .values({ name: "W", slug: `w-${crypto.randomUUID()}` })
    .returning();
  const [u] = await db
    .insert(users)
    .values({
      email: `u-${crypto.randomUUID()}@x`,
      name: "U",
      supabaseUserId: crypto.randomUUID(),
    })
    .returning();
  const [m] = await db
    .insert(members)
    // biome-ignore lint/style/noNonNullAssertion: test setup
    .values({ workspaceId: ws!.id, userId: u!.id, role: "owner" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  return { ws: ws!, m: m! };
}

describe("runtime-monitor", () => {
  beforeEach(async () => {
    // Each test reseeds; nothing to do here, but keep the hook for future use.
  });

  it("marks a runtime offline when last_heartbeat_at older than threshold", async () => {
    const { ws, m } = await seed();
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    const [rt] = await db
      .insert(runtimes)
      .values({
        workspaceId: ws.id,
        memberId: m.id,
        name: "stale",
        machineTokenHash: crypto.randomUUID(),
        online: true,
        lastHeartbeatAt: tenMinAgo,
      })
      .returning();
    const result = await tickRuntimeMonitor();
    expect(result.runtimesMarkedOffline).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const after = await db.query.runtimes.findFirst({ where: eq(runtimes.id, rt!.id) });
    expect(after?.online).toBe(false);
  });

  it("fails a stuck dispatched task with failure_reason runtime_recovery", async () => {
    const { ws, m } = await seed();
    const [rt] = await db
      .insert(runtimes)
      .values({
        workspaceId: ws.id,
        memberId: m.id,
        name: "rt",
        machineTokenHash: crypto.randomUUID(),
      })
      .returning();
    const [agent] = await db
      .insert(agents)
      .values({
        workspaceId: ws.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        runtimeId: rt!.id,
        name: "a",
        cliKind: "claude_code",
        maxConcurrentTasks: 1,
        instructions: "",
      })
      .returning();
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    const [task] = await db
      .insert(agentTaskQueue)
      .values({
        workspaceId: ws.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        agentId: agent!.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        runtimeId: rt!.id,
        status: "dispatched",
        dispatchedAt: tenMinAgo,
      })
      .returning();
    const result = await tickRuntimeMonitor();
    expect(result.tasksFailed).toBe(1);
    const after = await db.query.agentTaskQueue.findFirst({
      // biome-ignore lint/style/noNonNullAssertion: test setup
      where: eq(agentTaskQueue.id, task!.id),
    });
    expect(after?.status).toBe("failed");
    expect(after?.failureReason).toBe("runtime_recovery");
    expect(after?.completedAt).not.toBeNull();
  });

  it("leaves fresh rows alone", async () => {
    const { ws, m } = await seed();
    await db.insert(runtimes).values({
      workspaceId: ws.id,
      memberId: m.id,
      name: "fresh",
      machineTokenHash: crypto.randomUUID(),
      online: true,
      lastHeartbeatAt: new Date(),
    });
    const result = await tickRuntimeMonitor();
    expect(result.runtimesMarkedOffline).toBe(0);
    expect(result.tasksFailed).toBe(0);
  });

  it("active reconciliation: cancels running tasks whose issue went terminal", async () => {
    const { ws, m } = await seed();
    const [rt] = await db
      .insert(runtimes)
      .values({
        workspaceId: ws.id,
        memberId: m.id,
        name: "rt",
        machineTokenHash: crypto.randomUUID(),
      })
      .returning();
    const [agent] = await db
      .insert(agents)
      .values({
        workspaceId: ws.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        runtimeId: rt!.id,
        name: "a",
        cliKind: "claude_code",
        instructions: "",
      })
      .returning();
    const [doneIssue] = await db
      .insert(issues)
      .values({
        workspaceId: ws.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        creatorId: m!.id,
        creatorKind: "member",
        number: 1,
        title: "issue closed by human",
        status: "done",
      })
      .returning();
    const [activeIssue] = await db
      .insert(issues)
      .values({
        workspaceId: ws.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        creatorId: m!.id,
        creatorKind: "member",
        number: 2,
        title: "still active",
        status: "in_progress",
      })
      .returning();
    const [taskOnDone] = await db
      .insert(agentTaskQueue)
      .values({
        workspaceId: ws.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        agentId: agent!.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        runtimeId: rt!.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        issueId: doneIssue!.id,
        status: "running",
        startedAt: new Date(),
        lastHeartbeatAt: new Date(), // fresh — would NOT be caught by stale-task sweep
      })
      .returning();
    const [taskOnActive] = await db
      .insert(agentTaskQueue)
      .values({
        workspaceId: ws.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        agentId: agent!.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        runtimeId: rt!.id,
        // biome-ignore lint/style/noNonNullAssertion: test setup
        issueId: activeIssue!.id,
        status: "running",
        startedAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      .returning();

    const result = await tickRuntimeMonitor();
    expect(result.tasksReconciled).toBe(1);
    expect(result.tasksFailed).toBe(0); // both are fresh; only the issue-state mismatch trips

    const cancelled = await db.query.agentTaskQueue.findFirst({
      // biome-ignore lint/style/noNonNullAssertion: test setup
      where: eq(agentTaskQueue.id, taskOnDone!.id),
    });
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.errorKind).toBe("canceled_by_reconciliation");

    const stillRunning = await db.query.agentTaskQueue.findFirst({
      // biome-ignore lint/style/noNonNullAssertion: test setup
      where: eq(agentTaskQueue.id, taskOnActive!.id),
    });
    expect(stillRunning?.status).toBe("running");
  });

  it("respects shortened thresholds passed via options", async () => {
    const { ws, m } = await seed();
    const fiveSecAgo = new Date(Date.now() - 5_000);
    const [rt] = await db
      .insert(runtimes)
      .values({
        workspaceId: ws.id,
        memberId: m.id,
        name: "borderline",
        machineTokenHash: crypto.randomUUID(),
        online: true,
        lastHeartbeatAt: fiveSecAgo,
      })
      .returning();
    // Default threshold (90s) leaves it alone.
    let result = await tickRuntimeMonitor();
    expect(result.runtimesMarkedOffline).toBe(0);
    // Tight 1-second threshold marks it offline.
    result = await tickRuntimeMonitor({ runtimeStaleMs: 1_000 });
    expect(result.runtimesMarkedOffline).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const after = await db.query.runtimes.findFirst({ where: eq(runtimes.id, rt!.id) });
    expect(after?.online).toBe(false);
  });
});

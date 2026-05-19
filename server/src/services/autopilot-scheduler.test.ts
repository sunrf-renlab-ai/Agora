import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agents,
  autopilotRuns,
  autopilotTriggers,
  autopilots,
  members,
  runtimes,
  users,
  workspaces,
} from "../db/schema/index";
import { generateMachineToken } from "../lib/machine-token";
import { tickScheduler } from "./autopilot-scheduler";

let workspaceId: string;
let userId: string;
let agentId: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `sch-${Date.now()}@x`, name: "S" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "S", slug: `s-${Date.now()}`, issuePrefix: "S", issueCounter: 0 })
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
      name: "sch-agent",
      // biome-ignore lint/style/noNonNullAssertion: test setup
      runtimeId: r!.id,
      cliKind: "claude_code",
    })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  agentId = a!.id;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("tickScheduler", () => {
  it("dispatches due triggers, advances next_run_at, leaves not-yet-due triggers alone", async () => {
    const [ap] = await db
      .insert(autopilots)
      .values({
        workspaceId,
        title: "Hourly task",
        assigneeId: agentId,
        executionMode: "create_issue",
        createdByKind: "member",
        createdById: userId,
      })
      .returning();
    // Due trigger
    const past = new Date(Date.now() - 60_000);
    const [dueTrig] = await db
      .insert(autopilotTriggers)
      .values({
        // biome-ignore lint/style/noNonNullAssertion: test setup
        autopilotId: ap!.id,
        kind: "schedule",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        nextRunAt: past,
        enabled: true,
      })
      .returning();
    // Not-yet-due trigger
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const [notDue] = await db
      .insert(autopilotTriggers)
      .values({
        // biome-ignore lint/style/noNonNullAssertion: test setup
        autopilotId: ap!.id,
        kind: "schedule",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        nextRunAt: future,
        enabled: true,
      })
      .returning();

    const dispatched = await tickScheduler();
    expect(dispatched).toBe(1);

    // The due trigger now has next_run_at advanced to a future time.
    const reloaded = await db.query.autopilotTriggers.findFirst({
      // biome-ignore lint/style/noNonNullAssertion: test setup
      where: eq(autopilotTriggers.id, dueTrig!.id),
    });
    expect(reloaded?.nextRunAt).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: tested above
    expect(reloaded!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(reloaded?.lastFiredAt).not.toBeNull();

    // The not-yet-due trigger is unchanged.
    const notDueReloaded = await db.query.autopilotTriggers.findFirst({
      // biome-ignore lint/style/noNonNullAssertion: test setup
      where: eq(autopilotTriggers.id, notDue!.id),
    });
    expect(notDueReloaded?.nextRunAt?.getTime()).toBe(future.getTime());

    // A run was created.
    const runs = await db.query.autopilotRuns.findMany({
      // biome-ignore lint/style/noNonNullAssertion: test setup
      where: eq(autopilotRuns.autopilotId, ap!.id),
    });
    expect(runs.length).toBe(1);
    expect(runs[0]?.source).toBe("schedule");
    expect(runs[0]?.status).toBe("issue_created");
  });

  it("skips disabled triggers", async () => {
    const [ap] = await db
      .insert(autopilots)
      .values({
        workspaceId,
        title: "T",
        assigneeId: agentId,
        executionMode: "create_issue",
        createdByKind: "member",
        createdById: userId,
      })
      .returning();
    const past = new Date(Date.now() - 60_000);
    await db
      .insert(autopilotTriggers)
      .values({
        // biome-ignore lint/style/noNonNullAssertion: test setup
        autopilotId: ap!.id,
        kind: "schedule",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        nextRunAt: past,
        enabled: false,
      })
      .returning();
    const n = await tickScheduler();
    expect(n).toBe(0);
  });

  it("skips paused autopilots", async () => {
    const [ap] = await db
      .insert(autopilots)
      .values({
        workspaceId,
        title: "T",
        assigneeId: agentId,
        executionMode: "create_issue",
        status: "paused",
        createdByKind: "member",
        createdById: userId,
      })
      .returning();
    const past = new Date(Date.now() - 60_000);
    await db.insert(autopilotTriggers).values({
      // biome-ignore lint/style/noNonNullAssertion: test setup
      autopilotId: ap!.id,
      kind: "schedule",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      nextRunAt: past,
      enabled: true,
    });
    const n = await tickScheduler();
    expect(n).toBe(0);
  });
});

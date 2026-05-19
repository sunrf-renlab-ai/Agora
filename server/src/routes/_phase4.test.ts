import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentTaskQueue,
  agents,
  autopilotRuns,
  autopilotTriggers,
  autopilots,
  issues,
  members,
  runtimes,
  users,
  workspaces,
} from "../db/schema/index";
import { generateMachineToken } from "../lib/machine-token";
import { tickScheduler } from "../services/autopilot-scheduler";

let workspaceId: string;
let userId: string;
let agentId: string;
let autopilotId: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `p4-${Date.now()}@x`, name: "P4" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "P4", slug: `p4-${Date.now()}`, issuePrefix: "P4", issueCounter: 0 })
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
      name: "p4-agent",
      // biome-ignore lint/style/noNonNullAssertion: test setup
      runtimeId: r!.id,
      cliKind: "claude_code",
    })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  agentId = a!.id;
  const [ap] = await db
    .insert(autopilots)
    .values({
      workspaceId,
      title: "Daily standup {{date}}",
      assigneeId: agentId,
      executionMode: "create_issue",
      createdByKind: "member",
      createdById: userId,
    })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  autopilotId = ap!.id;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("Phase 4 critical flow: cron-triggered autopilot creates issue + dispatches task", () => {
  it("end to end: due trigger → tickScheduler → run + issue + queued task", async () => {
    const past = new Date(Date.now() - 60_000);
    await db.insert(autopilotTriggers).values({
      autopilotId,
      kind: "schedule",
      cronExpression: "* * * * *",
      timezone: "UTC",
      nextRunAt: past,
      enabled: true,
    });

    const dispatched = await tickScheduler();
    expect(dispatched).toBe(1);

    const runs = await db.query.autopilotRuns.findMany({
      where: eq(autopilotRuns.autopilotId, autopilotId),
    });
    expect(runs.length).toBe(1);
    expect(runs[0]?.status).toBe("issue_created");
    expect(runs[0]?.source).toBe("schedule");
    expect(runs[0]?.issueId).not.toBeNull();

    const issue = await db.query.issues.findFirst({
      // biome-ignore lint/style/noNonNullAssertion: tested above
      where: eq(issues.id, runs[0]!.issueId!),
    });
    expect(issue?.originType).toBe("autopilot");
    expect(issue?.originId).toBe(autopilotId);
    expect(issue?.title).toMatch(/^Daily standup \d{4}-\d{2}-\d{2}$/);
    expect(issue?.assigneeKind).toBe("agent");

    const tasks = await db.query.agentTaskQueue.findMany({
      // biome-ignore lint/style/noNonNullAssertion: tested above
      where: eq(agentTaskQueue.issueId, issue!.id),
    });
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.status).toBe("queued");
    expect(tasks[0]?.agentId).toBe(agentId);

    const triggers = await db.query.autopilotTriggers.findMany({
      where: eq(autopilotTriggers.autopilotId, autopilotId),
    });
    expect(triggers[0]?.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
    expect(triggers[0]?.lastFiredAt).not.toBeNull();
  });
});

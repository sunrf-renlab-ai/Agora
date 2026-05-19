import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentTaskQueue,
  agents,
  autopilotRuns,
  autopilots,
  issues,
  members,
  runtimes,
  users,
  workspaces,
} from "../db/schema/index";
import { generateMachineToken } from "../lib/machine-token";
import { dispatchAutopilot, syncRunFromIssue, syncRunFromTask } from "./autopilot";

let workspaceId: string;
let userId: string;
let agentId: string;
let runtimeId: string;

beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `ap-${Date.now()}@x`, name: "AP" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "AP", slug: `ap-${Date.now()}`, issuePrefix: "AP", issueCounter: 0 })
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
  // biome-ignore lint/style/noNonNullAssertion: test setup
  runtimeId = r!.id;
  const [a] = await db
    .insert(agents)
    .values({ workspaceId, name: "ap-agent", runtimeId, cliKind: "claude_code" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  agentId = a!.id;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("dispatchAutopilot", () => {
  it("create_issue: increments counter, creates issue with origin=autopilot, enqueues task, run.status=issue_created", async () => {
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
    const run = await dispatchAutopilot(ap!, { source: "manual" });

    expect(run.status).toBe("issue_created");
    expect(run.issueId).not.toBeNull();

    // biome-ignore lint/style/noNonNullAssertion: tested above
    const issue = await db.query.issues.findFirst({ where: eq(issues.id, run.issueId!) });
    expect(issue?.originType).toBe("autopilot");
    // biome-ignore lint/style/noNonNullAssertion: tested above
    expect(issue!.originId).toBe(ap!.id);
    expect(issue?.title).toMatch(/^Daily standup \d{4}-\d{2}-\d{2}$/);
    expect(issue?.assigneeKind).toBe("agent");
    expect(issue?.assigneeId).toBe(agentId);
    expect(issue?.number).toBe(1);

    const tasks = await db.query.agentTaskQueue.findMany({
      // biome-ignore lint/style/noNonNullAssertion: tested above
      where: eq(agentTaskQueue.issueId, issue!.id),
    });
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.status).toBe("queued");

    // last_run_at on autopilot is set
    // biome-ignore lint/style/noNonNullAssertion: tested above
    const reloaded = await db.query.autopilots.findFirst({ where: eq(autopilots.id, ap!.id) });
    expect(reloaded?.lastRunAt).not.toBeNull();
  });

  it("syncRunFromIssue: issue->done marks run completed", async () => {
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
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const run = await dispatchAutopilot(ap!, { source: "manual" });
    const [issue] = await db
      .update(issues)
      .set({ status: "done" })
      // biome-ignore lint/style/noNonNullAssertion: tested above
      .where(eq(issues.id, run.issueId!))
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: tested above
    await syncRunFromIssue(issue!);
    const reloaded = await db.query.autopilotRuns.findFirst({
      where: eq(autopilotRuns.id, run.id),
    });
    expect(reloaded?.status).toBe("completed");
    expect(reloaded?.completedAt).not.toBeNull();
  });

  it("run_only: enqueues issueless task linked to run, run starts in 'running'", async () => {
    const [ap] = await db
      .insert(autopilots)
      .values({
        workspaceId,
        title: "Sweep nightly",
        assigneeId: agentId,
        executionMode: "run_only",
        createdByKind: "member",
        createdById: userId,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const run = await dispatchAutopilot(ap!, { source: "manual", triggerPayload: { foo: "bar" } });
    expect(run.status).toBe("running");
    expect(run.issueId).toBeNull();
    expect(run.taskId).not.toBeNull();
    expect(run.triggerPayload).toEqual({ foo: "bar" });

    // biome-ignore lint/style/noNonNullAssertion: tested above
    const task = await db.query.agentTaskQueue.findFirst({
      where: eq(agentTaskQueue.id, run.taskId!),
    });
    expect(task?.autopilotRunId).toBe(run.id);
    expect(task?.issueId).toBeNull();
    expect(task?.originType).toBe("autopilot");
  });

  it("syncRunFromTask: run_only task->completed marks run completed with result", async () => {
    const [ap] = await db
      .insert(autopilots)
      .values({
        workspaceId,
        title: "Sweep",
        assigneeId: agentId,
        executionMode: "run_only",
        createdByKind: "member",
        createdById: userId,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const run = await dispatchAutopilot(ap!, { source: "manual" });
    const [task] = await db
      .update(agentTaskQueue)
      .set({ status: "completed", result: { reply: "done" }, completedAt: new Date() })
      // biome-ignore lint/style/noNonNullAssertion: tested above
      .where(eq(agentTaskQueue.id, run.taskId!))
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: tested above
    await syncRunFromTask(task!);
    const reloaded = await db.query.autopilotRuns.findFirst({
      where: eq(autopilotRuns.id, run.id),
    });
    expect(reloaded?.status).toBe("completed");
    expect(reloaded?.completedAt).not.toBeNull();
    expect(reloaded?.result).toEqual({ reply: "done" });
  });

  it("syncRunFromTask: run_only task->failed marks run failed with error", async () => {
    const [ap] = await db
      .insert(autopilots)
      .values({
        workspaceId,
        title: "Sweep",
        assigneeId: agentId,
        executionMode: "run_only",
        createdByKind: "member",
        createdById: userId,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const run = await dispatchAutopilot(ap!, { source: "manual" });
    const [task] = await db
      .update(agentTaskQueue)
      .set({ status: "failed", error: "agent blew up", completedAt: new Date() })
      // biome-ignore lint/style/noNonNullAssertion: tested above
      .where(eq(agentTaskQueue.id, run.taskId!))
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: tested above
    await syncRunFromTask(task!);
    const reloaded = await db.query.autopilotRuns.findFirst({
      where: eq(autopilotRuns.id, run.id),
    });
    expect(reloaded?.status).toBe("failed");
    expect(reloaded?.failureReason).toBe("agent blew up");
  });

  it("syncRunFromTask: create_issue task->failed marks run failed (no issue update)", async () => {
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
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const run = await dispatchAutopilot(ap!, { source: "manual" });
    const [task] = await db
      .update(agentTaskQueue)
      .set({ status: "failed", error: "iteration_limit", completedAt: new Date() })
      // biome-ignore lint/style/noNonNullAssertion: tested above
      .where(eq(agentTaskQueue.id, run.taskId!))
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: tested above
    await syncRunFromTask(task!);
    const reloaded = await db.query.autopilotRuns.findFirst({
      where: eq(autopilotRuns.id, run.id),
    });
    expect(reloaded?.status).toBe("failed");
    expect(reloaded?.failureReason).toBe("iteration_limit");
  });

  it("syncRunFromIssue: issue->cancelled marks run failed", async () => {
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
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const run = await dispatchAutopilot(ap!, { source: "manual" });
    const [issue] = await db
      .update(issues)
      .set({ status: "cancelled" })
      // biome-ignore lint/style/noNonNullAssertion: tested above
      .where(eq(issues.id, run.issueId!))
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: tested above
    await syncRunFromIssue(issue!);
    const reloaded = await db.query.autopilotRuns.findFirst({
      where: eq(autopilotRuns.id, run.id),
    });
    expect(reloaded?.status).toBe("failed");
    expect(reloaded?.failureReason).toBe("issue cancelled");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentTaskQueue,
  agents,
  issueDependencies,
  issues,
  members,
  runtimes,
  users,
  workspaces,
} from "../db/schema/index";
import { generateMachineToken } from "../lib/machine-token";
import { sweepUnblocked } from "./issue-unblock";

let workspaceId: string;
let userId: string;
let runtimeId: string;
let agentId: string;
let blockerId: string;
let dependentId: string;

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [u] = await db
    .insert(users)
    .values({ email: `unblock-${stamp}@x`, name: "Tester" })
    .returning();
  userId = u?.id as string;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "UB", slug: `ub-${stamp}`, issuePrefix: "UB" })
    .returning();
  workspaceId = w?.id as string;
  const [m] = await db
    .insert(members)
    .values({ workspaceId, userId, role: "owner" })
    .returning();
  const memberId = m?.id as string;
  const tok = generateMachineToken();
  const [r] = await db
    .insert(runtimes)
    .values({
      workspaceId,
      memberId,
      name: "test-rt",
      machineTokenHash: tok.hash,
      daemonVersion: "0.0.1",
      online: true,
    })
    .returning();
  runtimeId = r?.id as string;
  const [a] = await db
    .insert(agents)
    .values({ workspaceId, name: "ub-agent", runtimeId, cliKind: "claude_code" })
    .returning();
  agentId = a?.id as string;
  const [blocker] = await db
    .insert(issues)
    .values({
      workspaceId,
      number: 1,
      title: "blocker",
      status: "in_progress",
      creatorKind: "member",
      creatorId: userId,
    })
    .returning();
  blockerId = blocker?.id as string;
  const [dep] = await db
    .insert(issues)
    .values({
      workspaceId,
      number: 2,
      title: "dependent",
      status: "blocked",
      assigneeKind: "agent",
      assigneeId: agentId,
      creatorKind: "member",
      creatorId: userId,
    })
    .returning();
  dependentId = dep?.id as string;
});

afterEach(async () => {
  // workspace cascade handles issues/agents/runtimes/members; user is the
  // only orphan after that. Test isolation is per-row uniqueness on slug,
  // so leaking a few rows is fine — but TRUNCATE keeps the suite clean.
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, userId));
});

describe("sweepUnblocked", () => {
  it("noop when the resolved issue has no dependents", async () => {
    await sweepUnblocked(workspaceId, blockerId);
    const stillBlocked = await db.query.issues.findFirst({
      where: eq(issues.id, dependentId),
    });
    expect(stillBlocked?.status).toBe("blocked");
  });

  it("flips dependent to todo and enqueues a task once the blocker resolves", async () => {
    await db.insert(issueDependencies).values({
      workspaceId,
      issueId: dependentId,
      dependsOnIssueId: blockerId,
      type: "blocks",
    });
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, blockerId));

    await sweepUnblocked(workspaceId, blockerId);

    const updated = await db.query.issues.findFirst({ where: eq(issues.id, dependentId) });
    expect(updated?.status).toBe("todo");

    const tasks = await db
      .select()
      .from(agentTaskQueue)
      .where(
        and(eq(agentTaskQueue.issueId, dependentId), eq(agentTaskQueue.agentId, agentId)),
      );
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.triggerSummary).toContain("unblocked by");
  });

  it("stays blocked when only one of multiple blockers has resolved", async () => {
    const [blocker2] = await db
      .insert(issues)
      .values({
        workspaceId,
        number: 3,
        title: "blocker-2",
        status: "in_progress",
        creatorKind: "member",
        creatorId: userId,
      })
      .returning();
    await db.insert(issueDependencies).values([
      { workspaceId, issueId: dependentId, dependsOnIssueId: blockerId, type: "blocks" },
      {
        workspaceId,
        issueId: dependentId,
        dependsOnIssueId: blocker2?.id as string,
        type: "blocks",
      },
    ]);
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, blockerId));

    await sweepUnblocked(workspaceId, blockerId);

    const stillBlocked = await db.query.issues.findFirst({
      where: eq(issues.id, dependentId),
    });
    expect(stillBlocked?.status).toBe("blocked");
    const tasks = await db
      .select()
      .from(agentTaskQueue)
      .where(eq(agentTaskQueue.issueId, dependentId));
    expect(tasks.length).toBe(0);
  });

  it("does not touch dependents whose status the user has changed away from blocked", async () => {
    await db.insert(issueDependencies).values({
      workspaceId,
      issueId: dependentId,
      dependsOnIssueId: blockerId,
      type: "blocks",
    });
    await db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, dependentId));
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, blockerId));

    await sweepUnblocked(workspaceId, blockerId);

    const dep = await db.query.issues.findFirst({ where: eq(issues.id, dependentId) });
    expect(dep?.status).toBe("in_progress"); // user-set value preserved
  });

  it("flips status but skips enqueue when the dependent is assigned to a member", async () => {
    await db
      .update(issues)
      .set({ assigneeKind: "member", assigneeId: userId })
      .where(eq(issues.id, dependentId));
    await db.insert(issueDependencies).values({
      workspaceId,
      issueId: dependentId,
      dependsOnIssueId: blockerId,
      type: "blocks",
    });
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, blockerId));

    await sweepUnblocked(workspaceId, blockerId);

    const updated = await db.query.issues.findFirst({ where: eq(issues.id, dependentId) });
    expect(updated?.status).toBe("todo");
    const tasks = await db
      .select()
      .from(agentTaskQueue)
      .where(eq(agentTaskQueue.issueId, dependentId));
    expect(tasks.length).toBe(0);
  });
});

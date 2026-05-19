// When an issue resolves (status flips to `done` or `cancelled`), look for
// every issue that was waiting on it. Anything still in `blocked` whose
// remaining blockers are also done flips back to `todo`; if it's assigned
// to an agent, we enqueue a fresh task so the daemon picks it up. Mirrors
// Linear's "you've been unblocked, here's a notification" behaviour, with
// the agent-specific twist that the notification is a real task instead.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { agents, issueDependencies, issues } from "../db/schema/index";
import { enqueueTaskForIssue } from "../lib/enqueue";
import { broadcastWorkspace } from "../lib/ws-hub";

const TERMINAL_STATUSES = new Set(["done", "cancelled"]);

/**
 * Sweep the dependency graph after `resolvedIssueId` flipped to a terminal
 * status. Best-effort: each step is wrapped so a single dependent's failure
 * doesn't poison the rest of the sweep. Safe to call multiple times — the
 * `status === 'blocked'` guard makes it idempotent.
 */
export async function sweepUnblocked(
  workspaceId: string,
  resolvedIssueId: string,
): Promise<void> {
  // 1) Find every issue Y such that (Y → resolvedIssueId) is a `blocks` edge.
  const dependentRows = await db
    .select({ dependentId: issueDependencies.issueId })
    .from(issueDependencies)
    .where(
      and(
        eq(issueDependencies.dependsOnIssueId, resolvedIssueId),
        eq(issueDependencies.type, "blocks"),
      ),
    );
  if (dependentRows.length === 0) return;
  const dependentIds = Array.from(new Set(dependentRows.map((r) => r.dependentId)));

  // 2) Pull the full row for each dependent — we need status / assignee.
  const dependents = await db
    .select()
    .from(issues)
    .where(and(eq(issues.workspaceId, workspaceId), inArray(issues.id, dependentIds)));

  for (const dep of dependents) {
    if (dep.status !== "blocked") continue; // user moved it manually; respect that

    // Check ALL blockers of this dependent, not just the one that just
    // resolved — a dependent with multiple blockers stays blocked until
    // every blocker is terminal.
    const blockers = await db
      .select({ status: issues.status })
      .from(issueDependencies)
      .innerJoin(issues, eq(issues.id, issueDependencies.dependsOnIssueId))
      .where(
        and(
          eq(issueDependencies.issueId, dep.id),
          eq(issueDependencies.type, "blocks"),
        ),
      );
    const allClear = blockers.every((b) => TERMINAL_STATUSES.has(b.status));
    if (!allClear) continue;

    // 3) Flip status from `blocked` back to `todo`. Done/cancelled were the
    // only blockers; everything else can wait until a human / agent picks
    // the issue up again.
    try {
      await db
        .update(issues)
        .set({ status: "todo", updatedAt: new Date() })
        .where(eq(issues.id, dep.id));
    } catch {
      continue;
    }

    broadcastWorkspace(workspaceId, {
      type: "issue.updated",
      data: { id: dep.id, workspaceId },
    });

    // 4) Agent assignee → enqueue a fresh task. Member assignee → no-op,
    // the kanban / inbox already surfaces the status change.
    if (dep.assigneeKind !== "agent" || !dep.assigneeId) continue;

    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, dep.assigneeId), eq(agents.workspaceId, workspaceId)),
    });
    if (!agent || agent.archivedAt || !agent.runtimeId) continue;

    try {
      await enqueueTaskForIssue({
        workspaceId,
        issueId: dep.id,
        agentId: agent.id,
        runtimeId: agent.runtimeId,
        triggerSummary: `unblocked by ${resolvedIssueId}`,
      });
    } catch {
      // Duplicate active task or transient DB error — skip; the agent's
      // existing task (if any) will still see status=todo on its next
      // turn. Worst case the user reruns manually.
    }
  }
}

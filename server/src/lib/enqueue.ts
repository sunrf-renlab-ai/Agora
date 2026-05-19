import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { agentTaskQueue } from "../db/schema/index";
import { daemonHub } from "./daemon-hub";
import { broadcastWorkspace } from "./ws-hub";

export interface EnqueueIssueArgs {
  workspaceId: string;
  issueId: string;
  agentId: string;
  runtimeId: string;
  triggerCommentId?: string | null;
  triggerSummary?: string | null;
  parentTaskId?: string | null;
  attempt?: number;
  maxAttempts?: number;
  forceFreshSession?: boolean;
}

export async function enqueueTaskForIssue(args: EnqueueIssueArgs) {
  const [task] = await db
    .insert(agentTaskQueue)
    .values({
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      runtimeId: args.runtimeId,
      issueId: args.issueId,
      triggerCommentId: args.triggerCommentId ?? null,
      triggerSummary: args.triggerSummary ?? null,
      parentTaskId: args.parentTaskId ?? null,
      attempt: args.attempt ?? 1,
      maxAttempts: args.maxAttempts ?? 2,
      forceFreshSession: args.forceFreshSession ? 1 : 0,
    })
    .returning();
  if (!task) throw new Error("enqueueTaskForIssue: insert returned no row");

  broadcastWorkspace(args.workspaceId, {
    type: "task.queued",
    data: {
      id: task.id,
      agentId: task.agentId,
      runtimeId: task.runtimeId,
      issueId: task.issueId,
      workspaceId: task.workspaceId,
    },
  });
  daemonHub.notifyTaskAvailable(args.runtimeId, task.id);
  return task;
}

export interface EnqueueQuickCreateArgs {
  workspaceId: string;
  agentId: string;
  runtimeId: string;
  prompt: string;
  requesterId: string;
}

export async function enqueueQuickCreateTask(args: EnqueueQuickCreateArgs) {
  const [task] = await db
    .insert(agentTaskQueue)
    .values({
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      runtimeId: args.runtimeId,
      issueId: null,
      originType: "quick_create",
      originId: null,
      quickCreatePrompt: args.prompt,
      triggerSummary: `quick-create by ${args.requesterId}`,
    })
    .returning();
  if (!task) throw new Error("enqueueQuickCreateTask: insert returned no row");

  await db.update(agentTaskQueue).set({ originId: task.id }).where(eq(agentTaskQueue.id, task.id));

  broadcastWorkspace(args.workspaceId, {
    type: "task.queued",
    data: {
      id: task.id,
      agentId: task.agentId,
      runtimeId: task.runtimeId,
      issueId: null,
      workspaceId: task.workspaceId,
    },
  });
  daemonHub.notifyTaskAvailable(args.runtimeId, task.id);
  return task;
}

export interface EnqueueChatArgs {
  workspaceId: string;
  chatSessionId: string;
  agentId: string;
  runtimeId: string;
  prompt: string;
}

export async function enqueueTaskForChat(args: EnqueueChatArgs) {
  const [task] = await db
    .insert(agentTaskQueue)
    .values({
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      runtimeId: args.runtimeId,
      issueId: null,
      chatSessionId: args.chatSessionId,
      quickCreatePrompt: args.prompt,
      triggerSummary: "chat message",
    })
    .returning();
  if (!task) throw new Error("enqueueTaskForChat: insert returned no row");

  broadcastWorkspace(args.workspaceId, {
    type: "task.queued",
    data: {
      id: task.id,
      agentId: task.agentId,
      runtimeId: task.runtimeId,
      issueId: null,
      workspaceId: task.workspaceId,
    },
  });
  daemonHub.notifyTaskAvailable(args.runtimeId, task.id);
  return task;
}

export async function claimNextTaskForRuntime(runtimeId: string) {
  return await db.transaction(async (tx) => {
    // Claim picks the next queued task that (a) is past its `next_attempt_at`
    // (backoff), (b) has both a global concurrency slot AND, when the agent
    // has a `concurrency_by_state` entry for the issue's current state, a
    // per-state slot.
    //
    // The per-state subquery joins active tasks back to their issues so we
    // count "running tasks whose issue is in state X" — that's how we
    // enforce "max 5 in-progress, max 2 in-rework" style budgets.
    const rows = await tx.execute(sql`
      SELECT atq.id FROM agent_task_queue atq
      JOIN agent a ON a.id = atq.agent_id
      LEFT JOIN issue ai ON ai.id = atq.issue_id
      WHERE atq.runtime_id = ${runtimeId}
        AND atq.status = 'queued'
        AND a.archived_at IS NULL
        AND (atq.next_attempt_at IS NULL OR atq.next_attempt_at <= now())
        AND (
          SELECT count(*) FROM agent_task_queue running
          WHERE running.agent_id = atq.agent_id
            AND running.status IN ('dispatched', 'running')
        ) < a.max_concurrent_tasks
        AND (
          ai.id IS NULL
          OR NOT (a.concurrency_by_state ? ai.status)
          OR (
            SELECT count(*) FROM agent_task_queue r
            JOIN issue ri ON ri.id = r.issue_id
            WHERE r.agent_id = atq.agent_id
              AND r.status IN ('dispatched', 'running')
              AND ri.status = ai.status
          ) < ((a.concurrency_by_state ->> ai.status)::int)
        )
        AND NOT EXISTS (
          SELECT 1 FROM agent_task_queue active
          WHERE active.agent_id = atq.agent_id
            AND active.status IN ('dispatched', 'running')
            AND (
              (atq.issue_id IS NOT NULL AND active.issue_id = atq.issue_id)
              OR (atq.chat_session_id IS NOT NULL AND active.chat_session_id = atq.chat_session_id)
              OR (
                atq.issue_id IS NULL AND atq.chat_session_id IS NULL
                AND atq.autopilot_run_id IS NULL
                AND active.issue_id IS NULL AND active.chat_session_id IS NULL
                AND active.autopilot_run_id IS NULL
              )
            )
        )
      ORDER BY atq.priority DESC, atq.created_at ASC
      LIMIT 1
      FOR UPDATE OF atq SKIP LOCKED
    `);

    const candidate = (rows as unknown as Array<{ id: string }>)[0];
    if (!candidate) return null;

    const [updated] = await tx
      .update(agentTaskQueue)
      .set({ status: "dispatched", dispatchedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentTaskQueue.id, candidate.id))
      .returning();

    if (!updated) return null;

    // Broadcast outside transaction ideally, but inside is acceptable here
    broadcastWorkspace(updated.workspaceId, {
      type: "task.dispatched",
      data: { id: updated.id, agentId: updated.agentId, runtimeId: updated.runtimeId },
    });

    return updated;
  });
}

export async function getResumeSession(agentId: string, issueId: string) {
  const rows = await db.execute(sql`
    SELECT session_id, work_dir FROM agent_task_queue
    WHERE agent_id = ${agentId} AND issue_id = ${issueId}
      AND (
        status = 'completed'
        OR (status = 'failed'
            AND COALESCE(failure_reason, '') NOT IN ('iteration_limit', 'agent_fallback_message'))
      )
      AND session_id IS NOT NULL
    ORDER BY COALESCE(completed_at, started_at, dispatched_at, created_at) DESC
    LIMIT 1;
  `);
  return (
    (rows as unknown as Array<{ session_id: string | null; work_dir: string | null }>)[0] ?? null
  );
}

export async function recoverOrphansForRuntime(runtimeId: string) {
  await db.execute(sql`
    UPDATE agent_task_queue
    SET status = 'failed',
        completed_at = now(),
        failure_reason = 'runtime_recovery',
        error = 'daemon restarted while task was in flight',
        updated_at = now()
    WHERE runtime_id = ${runtimeId} AND status IN ('dispatched', 'running');
  `);
}

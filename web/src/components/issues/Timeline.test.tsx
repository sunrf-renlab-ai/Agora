import { describe, expect, it } from "bun:test";
import { mergeChronological } from "./Timeline";
import type { ActivityEntry, AgentTask } from "@agora/shared";

function ae(id: string, createdAt: string): ActivityEntry {
  return {
    id,
    workspaceId: "w",
    issueId: "i",
    actorKind: null,
    actorId: null,
    actor: null,
    action: "issue.created",
    details: {},
    createdAt,
  };
}

function at(id: string, createdAt: string): AgentTask {
  return {
    id,
    workspaceId: "w",
    agentId: "a",
    runtimeId: "r",
    issueId: "i",
    status: "completed",
    priority: 0,
    triggerCommentId: null,
    triggerSummary: null,
    sessionId: null,
    workDir: null,
    originType: null,
    originId: null,
    quickCreatePrompt: null,
    attempt: 1,
    maxAttempts: 2,
    parentTaskId: null,
    failureReason: null,
    error: null,
    result: null,
    dispatchedAt: null,
    startedAt: null,
    lastHeartbeatAt: null,
    completedAt: null,
    chatSessionId: null,
    autopilotRunId: null,
    forceFreshSession: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("mergeChronological", () => {
  it("interleaves activity and tasks by createdAt ascending", () => {
    const out = mergeChronological(
      [ae("a1", "2026-01-01T00:00:00Z"), ae("a2", "2026-01-03T00:00:00Z")],
      [at("t1", "2026-01-02T00:00:00Z")],
    );
    expect(out.map((e) => e.kind + ":" + (e.kind === "activity" ? e.entry.id : e.task.id))).toEqual([
      "activity:a1",
      "task:t1",
      "activity:a2",
    ]);
  });

  it("returns empty array when both inputs empty", () => {
    expect(mergeChronological([], [])).toEqual([]);
  });

  it("is stable when timestamps tie (task before activity at same instant)", () => {
    // Convention: tasks come first when timestamps tie so the originating
    // run appears above the system event it produced.
    const out = mergeChronological(
      [ae("a", "2026-01-01T00:00:00Z")],
      [at("t", "2026-01-01T00:00:00Z")],
    );
    expect(out[0]?.kind).toBe("task");
  });
});

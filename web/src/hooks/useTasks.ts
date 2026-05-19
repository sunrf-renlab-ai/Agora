"use client";
import { api } from "@/lib/api";
import type { AgentTask, TaskMessage, WSMessage } from "@agora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useWSChannel } from "./useWSChannel";

export function useTasksForIssue(
  token: string | null,
  workspaceId: string | null,
  issueId: string | null,
) {
  return useQuery<AgentTask[]>({
    queryKey: ["tasks", workspaceId, issueId],
    queryFn: () => {
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      return api.listTasksForIssue(token!, workspaceId!, issueId!) as Promise<AgentTask[]>;
    },
    enabled: !!token && !!workspaceId && !!issueId,
  });
}

export function useCancelTask(token: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => {
      // biome-ignore lint/style/noNonNullAssertion: mutationFn only called when both are truthy
      return api.cancelTask(token!, workspaceId!, taskId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", workspaceId] });
    },
  });
}

// Per-task agent execution timeline. The daemon batch-uploads messages
// during a run; the web fetches the full list on mount + expansion, then
// applies INCREMENTAL deltas on every `task.messages_appended` WS event
// (server returns { messages, nextSince } — we keep nextSince in a ref so
// each delta refetch only pulls the new tail). `enabled` is the on/off
// switch the card uses to avoid fetching for collapsed rows.
//
// The hook also drives the per-task WS subscription: when enabled, it
// sends a `subscribe:task` frame on the existing workspace socket so the
// server only fans `task.messages_appended` to clients that actually have
// this card open. On collapse / unmount it sends `unsubscribe:task` so
// the server-side channel set stays tight.
export function useTaskMessages(
  token: string | null,
  workspaceId: string | null,
  taskId: string | null,
  enabled: boolean,
) {
  const qc = useQueryClient();
  // lastSeenRef holds the highest seq the cache has observed for this
  // task. Initial fetch resets it from `nextSince`; deltas advance it.
  // Stored in a ref (not state) so updating it doesn't re-render the card.
  const lastSeenRef = useRef<number | null>(null);

  const query = useQuery<TaskMessage[]>({
    queryKey: ["taskMessages", workspaceId, taskId],
    queryFn: async () => {
      // Initial load — pull the full history (since=0 implicit) and seed
      // lastSeenRef from nextSince. Subsequent updates are delta-only.
      // biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are truthy
      const envelope = (await api.listTaskMessages(token!, workspaceId!, taskId!)) as {
        messages: TaskMessage[];
        nextSince: number | null;
      };
      lastSeenRef.current = envelope.nextSince ?? lastSeenRef.current;
      return envelope.messages;
    },
    enabled: enabled && !!token && !!workspaceId && !!taskId,
  });

  // Per-task WS subscription + incremental delta application. Rides on
  // top of the workspace socket via subscribe:task frames — no new socket.
  const { send: wsSend } = useWSChannel(workspaceId, (msg: WSMessage) => {
    const event = msg.event;
    if (event.type !== "task.messages_appended") return;
    if (event.data.id !== taskId) return;
    if (!token || !workspaceId || !taskId) return;
    // The latestSeq on the event is just a hint that something appended —
    // we trust our own lastSeenRef as the watermark to fetch from. Older
    // (stale) events that arrive after a recent refetch will produce an
    // empty delta and a no-op cache set.
    const since = lastSeenRef.current ?? 0;
    void (async () => {
      const envelope = (await api.listTaskMessages(token, workspaceId, taskId, { since })) as {
        messages: TaskMessage[];
        nextSince: number | null;
      };
      if (envelope.messages.length === 0 && envelope.nextSince == null) return;
      if (envelope.nextSince != null) lastSeenRef.current = envelope.nextSince;
      qc.setQueryData<TaskMessage[]>(
        ["taskMessages", workspaceId, taskId],
        (prev) => {
          if (!prev) return envelope.messages;
          if (envelope.messages.length === 0) return prev;
          // Dedupe by id — the server may resend a row if its seq window
          // overlaps (e.g. resubmit edge case). Cheap because the delta is
          // bounded to the new tail.
          const seen = new Set(prev.map((m) => m.id));
          const additions = envelope.messages.filter((m) => !seen.has(m.id));
          return additions.length === 0 ? prev : [...prev, ...additions];
        },
      );
    })();
  });

  // Subscribe/unsubscribe to the per-task channel based on `enabled`. The
  // server keeps a small set per channel, so collapsed cards must drop
  // out — otherwise an idle workspace tab with 50 tasks fanned in would
  // still see every chatty agent's stream.
  useEffect(() => {
    if (!enabled || !taskId) return;
    // Fire-and-forget; useWSChannel internally retries until the socket
    // is open, but `send` returns false if not. We send on every enabled
    // transition AND on a short retry loop until it lands (matches how
    // IssueDetailView announces presence).
    let landed = false;
    const tryJoin = () => {
      const ok = wsSend({ type: "subscribe:task", taskId });
      if (ok) landed = true;
    };
    tryJoin();
    const retry = setInterval(() => {
      if (!landed) tryJoin();
    }, 500);
    return () => {
      clearInterval(retry);
      wsSend({ type: "unsubscribe:task", taskId });
    };
  }, [enabled, taskId, wsSend]);

  return query;
}

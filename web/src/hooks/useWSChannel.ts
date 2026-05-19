"use client";
import { createClient } from "@/lib/supabase/client";
import type { WSMessage } from "@agora/shared";
import { useCallback, useEffect, useRef } from "react";

// In the browser, derive WS URL from the current origin when env var isn't
// set — production goes through Vercel's `/ws` → Render rewrite. SSR build
// has no window, so default to localhost (only hit during `next dev`).
const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ??
  (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "ws://localhost:8080");

// ---- Shared connection registry ----------------------------------------
// Earlier each useWSChannel call opened its OWN WebSocket. With a half-
// dozen call sites mounted at once (inbox, IssueDetailView, issues page,
// projects page, ExecutionLogSection, plus each expanded AgentRunCard
// subscribing for per-task deltas) a single workspace tab would burn
// 6-10 sockets — same auth handshake, same fan-out, same heartbeats.
// We now keep one socket per `workspaceId` and ref-count it: hook
// instances register a listener, and the socket only tears down when
// the last listener unmounts.
//
// Why a module-level map and not a context provider? Because every page
// + many components call this hook directly and threading a provider
// through Next's app router for a transport detail would be invasive.
// The registry is keyed by workspaceId and lifecycle is fully ref-
// counted, so leaks are bounded to the slot that's actually in use.

interface SharedConn {
  ws: WebSocket | null;
  // Listeners are keyed by a stable id (so a single hook instance can
  // swap its callback without re-registering). Each entry holds a ref
  // pointing to the latest callback so the listener always sees the
  // freshest closure without us having to re-bind the socket.
  listeners: Map<number, { current: (msg: WSMessage) => void }>;
  // Same idea, but only one shared backoff timer exists per workspace.
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  // Refcount of active hook instances. When this drops to 0 we close
  // the socket and delete the slot.
  refs: number;
  // Latched between transition states so a fast unmount+remount doesn't
  // race the supabase getSession() in `connect()`.
  destroyed: boolean;
}

const connections = new Map<string, SharedConn>();
let listenerSeq = 0;

async function ensureSocket(workspaceId: string) {
  const conn = connections.get(workspaceId);
  if (!conn) return;
  if (conn.destroyed) return;
  if (conn.ws && (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  // Double-check after the await — the slot may have been torn down
  // (refs went to 0) while we were resolving the session token.
  const stillThere = connections.get(workspaceId);
  if (!stillThere || stillThere !== conn || conn.destroyed) return;

  const ws = new WebSocket(
    `${WS_URL}/ws?token=${data.session.access_token}&workspaceId=${workspaceId}`,
  );
  conn.ws = ws;

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string) as WSMessage;
      for (const ref of conn.listeners.values()) {
        try {
          ref.current(msg);
        } catch {
          // one bad listener shouldn't poison the rest
        }
      }
    } catch {
      // ignore malformed WS messages
    }
  };

  ws.onclose = () => {
    conn.ws = null;
    if (conn.destroyed || conn.refs === 0) return;
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      void ensureSocket(workspaceId);
    }, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function acquire(workspaceId: string, listener: { current: (msg: WSMessage) => void }) {
  let conn = connections.get(workspaceId);
  if (!conn) {
    conn = {
      ws: null,
      listeners: new Map(),
      reconnectTimer: null,
      refs: 0,
      destroyed: false,
    };
    connections.set(workspaceId, conn);
  }
  const id = ++listenerSeq;
  conn.listeners.set(id, listener);
  conn.refs += 1;
  void ensureSocket(workspaceId);
  return id;
}

function release(workspaceId: string, id: number) {
  const conn = connections.get(workspaceId);
  if (!conn) return;
  conn.listeners.delete(id);
  conn.refs = Math.max(0, conn.refs - 1);
  if (conn.refs === 0) {
    conn.destroyed = true;
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }
    conn.ws?.close();
    conn.ws = null;
    connections.delete(workspaceId);
  }
}

function sendOn(workspaceId: string, frame: unknown): boolean {
  const conn = connections.get(workspaceId);
  if (!conn?.ws || conn.ws.readyState !== WebSocket.OPEN) return false;
  conn.ws.send(JSON.stringify(frame));
  return true;
}

export function useWSChannel(workspaceId: string | null, onMessage: (msg: WSMessage) => void) {
  // Keep the latest callback in a ref so the shared registry can dispatch
  // through the current closure without us having to re-register on every
  // render.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!workspaceId) return;
    const id = acquire(workspaceId, onMessageRef);
    return () => {
      release(workspaceId, id);
    };
  }, [workspaceId]);

  const send = useCallback(
    (frame: unknown) => {
      if (!workspaceId) return false;
      return sendOn(workspaceId, frame);
    },
    [workspaceId],
  );

  return { send };
}

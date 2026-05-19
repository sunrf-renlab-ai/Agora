import type { WSMessage } from "@agora/shared";

type SocketSet = Set<WebSocket>;

const channels = new Map<string, SocketSet>();

export function subscribe(channel: string, ws: WebSocket) {
  let set = channels.get(channel);
  if (!set) {
    set = new Set();
    channels.set(channel, set);
  }
  set.add(ws);
}

export function unsubscribe(ws: WebSocket) {
  for (const [channel, sockets] of channels) {
    sockets.delete(ws);
    if (sockets.size === 0) channels.delete(channel);
  }
}

// Targeted single-channel unsubscribe — leaves the socket's other
// subscriptions (e.g. its workspace channel) intact. Used when a client
// collapses a per-task card and we want to stop fanning task deltas to
// it without tearing down the workspace stream.
export function unsubscribeChannel(ws: WebSocket, channel: string) {
  const sockets = channels.get(channel);
  if (!sockets) return;
  sockets.delete(ws);
  if (sockets.size === 0) channels.delete(channel);
}

export function broadcast(channel: string, event: WSMessage["event"]) {
  // WSMessage carries `workspaceId` so clients can route fan-out. For
  // workspace channels we recover it from the channel name; for non-
  // workspace channels (e.g. task:<id>) we pull it from the event payload
  // when present, falling back to an empty string so we never construct
  // a malformed frame.
  let workspaceId = "";
  if (channel.startsWith("workspace:")) {
    workspaceId = channel.slice("workspace:".length);
  } else {
    const data = (event as { data?: { workspaceId?: unknown } }).data;
    if (data && typeof data === "object" && typeof data.workspaceId === "string") {
      workspaceId = data.workspaceId;
    }
  }
  const msg: WSMessage = { event, workspaceId };
  const payload = JSON.stringify(msg);
  const sockets = channels.get(channel);
  if (!sockets) return;
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

export const hub = { subscribe, unsubscribe, broadcast };

export function broadcastWorkspace(workspaceId: string, event: WSMessage["event"]) {
  hub.broadcast(`workspace:${workspaceId}`, event);
}

// Per-task channel — used for high-frequency, per-task events like
// `task.messages_appended`. Subscribers join `task:<taskId>` explicitly
// (see ws.ts onMessage subscribe frame) so a chatty agent run only fans
// out to clients that actually have that card expanded, not every
// connected member of the workspace.
export function broadcastTask(taskId: string, event: WSMessage["event"]) {
  hub.broadcast(`task:${taskId}`, event);
}

// ---- Presence ----

interface ViewerIdentity {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
}

// socket -> { issueId, viewer } so we can clean up on disconnect.
const socketPresence = new Map<
  WebSocket,
  { workspaceId: string; issueId: string; viewer: ViewerIdentity }
>();
// (workspaceId,issueId) -> Map<userId, viewer> (one entry per user across multiple sockets)
const issueViewers = new Map<string, Map<string, ViewerIdentity>>();

function presenceKey(workspaceId: string, issueId: string) {
  return `${workspaceId}:${issueId}`;
}

function viewersOf(workspaceId: string, issueId: string): ViewerIdentity[] {
  const map = issueViewers.get(presenceKey(workspaceId, issueId));
  return map ? Array.from(map.values()) : [];
}

function broadcastPresence(workspaceId: string, issueId: string) {
  broadcastWorkspace(workspaceId, {
    type: "presence.changed",
    data: { workspaceId, issueId, viewers: viewersOf(workspaceId, issueId) },
  });
}

export function setPresence(
  ws: WebSocket,
  workspaceId: string,
  issueId: string,
  viewer: ViewerIdentity,
) {
  const prior = socketPresence.get(ws);
  if (prior && (prior.workspaceId !== workspaceId || prior.issueId !== issueId)) {
    clearPresence(ws);
  }
  socketPresence.set(ws, { workspaceId, issueId, viewer });
  const key = presenceKey(workspaceId, issueId);
  let map = issueViewers.get(key);
  if (!map) {
    map = new Map();
    issueViewers.set(key, map);
  }
  map.set(viewer.userId, viewer);
  broadcastPresence(workspaceId, issueId);
}

export function clearPresence(ws: WebSocket) {
  const prior = socketPresence.get(ws);
  if (!prior) return;
  socketPresence.delete(ws);
  const key = presenceKey(prior.workspaceId, prior.issueId);
  const map = issueViewers.get(key);
  if (!map) return;
  // Only drop the user from the room if no other socket from the same user
  // is still viewing this issue. Cheap O(N) over current sockets.
  let stillPresent = false;
  for (const [otherWs, info] of socketPresence) {
    if (otherWs === ws) continue;
    if (
      info.workspaceId === prior.workspaceId &&
      info.issueId === prior.issueId &&
      info.viewer.userId === prior.viewer.userId
    ) {
      stillPresent = true;
      break;
    }
  }
  if (!stillPresent) {
    map.delete(prior.viewer.userId);
    if (map.size === 0) issueViewers.delete(key);
  }
  broadcastPresence(prior.workspaceId, prior.issueId);
}

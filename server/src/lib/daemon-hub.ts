type WsLike = { readyState: number; send: (data: string) => void; OPEN?: number } | WebSocket;

const sockets = new Map<string, Set<WsLike>>();

function isOpen(ws: WsLike): boolean {
  return (ws as { readyState: number }).readyState === 1;
}

export const daemonHub = {
  attach(runtimeId: string, ws: WsLike) {
    let set = sockets.get(runtimeId);
    if (!set) {
      set = new Set();
      sockets.set(runtimeId, set);
    }
    set.add(ws);
  },
  detach(runtimeId: string, ws: WsLike) {
    const set = sockets.get(runtimeId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) sockets.delete(runtimeId);
  },
  isOnline(runtimeId: string): boolean {
    const set = sockets.get(runtimeId);
    if (!set) return false;
    for (const ws of set) if (isOpen(ws)) return true;
    return false;
  },
  notifyTaskAvailable(runtimeId: string, taskId: string) {
    const set = sockets.get(runtimeId);
    if (!set) return;
    const payload = JSON.stringify({ type: "task.available", runtimeId, taskId });
    for (const ws of set) if (isOpen(ws)) ws.send(payload);
  },
  notifySkillSync(runtimeId: string, payload: { bundles: unknown[]; removeNames: string[] }) {
    const set = sockets.get(runtimeId);
    if (!set) return;
    const data = JSON.stringify({
      type: "skill.sync",
      runtimeId,
      bundles: payload.bundles,
      removeNames: payload.removeNames,
    });
    for (const ws of set) if (isOpen(ws)) ws.send(data);
  },
  notifySkillDiscover(
    runtimeId: string,
    requestId: string,
    kind: "list" | "import",
    skillKey?: string,
  ): boolean {
    const set = sockets.get(runtimeId);
    if (!set) return false;
    const data = JSON.stringify({
      type: "skill.discover",
      runtimeId,
      requestId,
      kind,
      ...(skillKey ? { skillKey } : {}),
    });
    let delivered = false;
    for (const ws of set)
      if (isOpen(ws)) {
        ws.send(data);
        delivered = true;
      }
    return delivered;
  },
};

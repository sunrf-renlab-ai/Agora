import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { runtimes } from "../db/schema/index";
import { upgradeWebSocket } from "../lib/bun-ws";
import { daemonHub } from "../lib/daemon-hub";
import { hashMachineToken } from "../lib/machine-token";
import { broadcastWorkspace } from "../lib/ws-hub";

const app = new Hono();

app.get(
  "/api/daemon/ws",
  upgradeWebSocket((c) => {
    const token = c.req.query("token") ?? "";
    const runtimeIdParam = c.req.query("runtime_id") ?? "";
    return {
      onOpen: async (_, ws) => {
        if (!token || !runtimeIdParam) {
          ws.close(1008, "Missing runtime_id or token");
          return;
        }
        const hash = hashMachineToken(token);
        const runtime = await db.query.runtimes.findFirst({
          where: eq(runtimes.machineTokenHash, hash),
        });
        if (!runtime || runtime.id !== runtimeIdParam) {
          ws.close(1008, "Invalid runtime credentials");
          return;
        }
        daemonHub.attach(runtime.id, ws.raw as unknown as WebSocket);
        await db
          .update(runtimes)
          .set({ online: true, lastHeartbeatAt: new Date(), updatedAt: new Date() })
          .where(eq(runtimes.id, runtime.id));
        broadcastWorkspace(runtime.workspaceId, {
          type: "runtime.online",
          data: { id: runtime.id, workspaceId: runtime.workspaceId },
        });
      },
      onMessage: async (event, ws) => {
        try {
          const frame = JSON.parse(String(event.data));
          if (frame?.type === "heartbeat" && frame.runtimeId) {
            await db
              .update(runtimes)
              .set({ lastHeartbeatAt: new Date(), online: true })
              .where(eq(runtimes.id, frame.runtimeId));
            ws.send(JSON.stringify({ type: "ack", ts: new Date().toISOString() }));
          }
        } catch {
          // ignore malformed
        }
      },
      onClose: async (_, ws) => {
        const all = await db.query.runtimes.findMany();
        for (const r of all) daemonHub.detach(r.id, ws.raw as unknown as WebSocket);
      },
    };
  }),
);

export default app;

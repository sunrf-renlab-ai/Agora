import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "../db/client";
import { users } from "../db/schema/index";
import { upgradeWebSocket } from "../lib/bun-ws";
import { clearPresence, hub, setPresence, unsubscribeChannel } from "../lib/ws-hub";

const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const JWKS = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));

const app = new Hono();

interface SocketCtx {
  supabaseUserId: string;
  workspaceId: string;
  // Resolved user info — populated on first onMessage that needs it.
  user: { id: string; name: string | null; avatarUrl: string | null } | null;
}

const socketCtx = new WeakMap<WebSocket, SocketCtx>();

async function ensureUser(ctx: SocketCtx) {
  if (ctx.user) return ctx.user;
  const u = await db.query.users.findFirst({
    where: eq(users.supabaseUserId, ctx.supabaseUserId),
  });
  if (u) {
    ctx.user = { id: u.id, name: u.name, avatarUrl: u.avatarUrl };
  }
  return ctx.user;
}

app.get(
  "/ws",
  upgradeWebSocket(async (c) => {
    const token = c.req.query("token");
    const workspaceId = c.req.query("workspaceId");

    return {
      onOpen: async (_, ws) => {
        if (!token || !workspaceId) {
          ws.close(1008, "Missing token or workspaceId");
          return;
        }
        let supabaseUserId: string | null = null;
        try {
          const verified = await jwtVerify(token, JWKS);
          supabaseUserId = (verified.payload.sub as string | undefined) ?? null;
        } catch {
          ws.close(1008, "Invalid token");
          return;
        }
        const raw = ws.raw as unknown as WebSocket;
        hub.subscribe(`workspace:${workspaceId}`, raw);
        if (supabaseUserId) {
          socketCtx.set(raw, { supabaseUserId, workspaceId, user: null });
        }
      },
      onClose: (_, ws) => {
        const raw = ws.raw as unknown as WebSocket;
        clearPresence(raw);
        hub.unsubscribe(raw);
        socketCtx.delete(raw);
      },
      onMessage: async (event, ws) => {
        const raw = ws.raw as unknown as WebSocket;
        const ctx = socketCtx.get(raw);
        if (!ctx) return;
        let frame: { type?: string; issueId?: string; taskId?: string };
        try {
          frame = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (frame.type === "presence:join" && typeof frame.issueId === "string") {
          const user = await ensureUser(ctx);
          if (!user) return;
          setPresence(raw, ctx.workspaceId, frame.issueId, {
            userId: user.id,
            name: user.name,
            avatarUrl: user.avatarUrl,
          });
        } else if (frame.type === "presence:leave") {
          clearPresence(raw);
        } else if (frame.type === "subscribe:task" && typeof frame.taskId === "string") {
          // Per-task channel subscription — keeps high-frequency
          // task.messages_appended events scoped to clients that actually
          // have the AgentRunCard expanded.
          hub.subscribe(`task:${frame.taskId}`, raw);
        } else if (frame.type === "unsubscribe:task" && typeof frame.taskId === "string") {
          // Best-effort cleanup so a collapsed card stops receiving deltas
          // even before the socket closes. `unsubscribe` blanket-clears
          // (which we still rely on at disconnect), so do a targeted
          // delete here to leave other channels intact.
          unsubscribeChannel(raw, `task:${frame.taskId}`);
        }
      },
    };
  }),
);

export default app;

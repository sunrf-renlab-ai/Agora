import {
  CONNECTION_KINDS,
  type ConnectionKind,
  type UserConnection,
} from "@agora/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { members, userConnections, users } from "../db/schema/index";
import { jsonError, notFound } from "../lib/errors";
import { consumeState, issueState } from "../lib/oauth-state";
import { encryptToken } from "../lib/token-crypto";
import { authMiddleware, requireUser } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";
import {
  buildAuthorizeUrl,
  clientCredentials,
  oauthByKind,
  type ParsedToken,
} from "../services/oauth-providers";

const app = new Hono();

function isKind(s: string): s is ConnectionKind {
  return (CONNECTION_KINDS as readonly string[]).includes(s);
}

/** Public: redirect target for the provider after the user authorizes.
 *  Must match what the OAuth app is registered with at the provider's
 *  developer console. Render's public URL by default. */
function callbackUrl(originHost: string): string {
  const explicit = process.env.AGORA_OAUTH_CALLBACK_URL?.replace(/\/+$/, "");
  if (explicit) return `${explicit}/api/connections/callback`;
  return `${originHost.replace(/\/+$/, "")}/api/connections/callback`;
}

/**
 * Where to send the user after a successful (or failed) callback. Set
 * to the web origin so the user lands back on /knowledge with a toast,
 * not on the bare API host. Falls back to APP_URL.
 */
function postCallbackRedirect(success: boolean, kind: ConnectionKind, reason?: string): string {
  const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  if (!base) return "/";
  const params = new URLSearchParams({
    kind,
    status: success ? "connected" : "failed",
    ...(reason ? { reason } : {}),
  });
  return `${base}/__connection-callback?${params.toString()}`;
}

// ------- Authenticated routes (require Supabase JWT) -------
// authMiddleware is wired per-route so the public OAuth callback
// (`GET /api/connections/callback`) doesn't accidentally inherit it.
// Hono's `app.use(middleware)` on a sub-app fires for any request
// that enters that app's routing — even paths with no matching
// route — which 401'd the callback in our first attempt.

app.get("/api/me/connections", authMiddleware, requireUser, async (c) => {
  const user = c.get("user");
  const rows = await db.query.userConnections.findMany({
    where: eq(userConnections.userId, user.id),
  });
  // Project to a stable, secret-free shape. Always include the
  // supported kinds so the UI doesn't have to merge.
  const byKind = new Map(rows.map((r) => [r.kind, r] as const));
  const out: UserConnection[] = CONNECTION_KINDS.map((kind) => {
    const r = byKind.get(kind);
    return {
      kind,
      status: r?.status ?? "pending",
      connectedAt: r?.connectedAt?.toISOString() ?? null,
    };
  });
  return c.json({ kinds: out });
});

app.post("/api/connections/:kind/start", authMiddleware, requireUser, async (c) => {
  const kind = c.req.param("kind");
  if (!isKind(kind)) return jsonError(c, 400, "unknown kind");
  const creds = clientCredentials(kind);
  if (!creds) {
    return jsonError(
      c,
      503,
      `OAuth not configured for ${kind}. Set AGORA_${oauthByKind[kind].envPrefix.toUpperCase()}_CLIENT_ID + _SECRET on Render.`,
    );
  }
  const user = c.get("user");
  const state = issueState(user.id, kind);
  const reqUrl = new URL(c.req.url);
  const redirectUri = callbackUrl(`${reqUrl.protocol}//${reqUrl.host}`);
  const authorizeUrl = buildAuthorizeUrl(kind, {
    clientId: creds.clientId,
    redirectUri,
    state,
  });
  return c.json({ authorizeUrl });
});

/**
 * Workspace-scoped aggregate. Lists every member's connection status
 * for the workspace, so /knowledge can show "who in the team is wired
 * to Linear / GitHub / Notion / Slack" without exposing tokens. Used
 * read-only by the team data-sources panel.
 *
 * Returns one row per (member, kind) — kinds with no connection are
 * included with status='pending' so the UI can render the full grid.
 */
app.get(
  "/api/workspaces/:workspaceId/connections",
  authMiddleware,
  workspaceMiddleware,
  async (c) => {
    const workspaceId = c.get("workspaceId");
    // Pull workspace members + their user identity, then their
    // connections. One join, no N+1.
    const rows = await db
      .select({
        userId: members.userId,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatarUrl,
        kind: userConnections.kind,
        status: userConnections.status,
        connectedAt: userConnections.connectedAt,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .leftJoin(userConnections, eq(userConnections.userId, members.userId))
      .where(eq(members.workspaceId, workspaceId));
    // Group by member so the UI can show one row per person with
    // chips/dots per connected kind.
    interface Member {
      userId: string;
      name: string;
      email: string;
      avatarUrl: string | null;
      connections: { kind: ConnectionKind; status: "pending" | "connected" | "revoked"; connectedAt: string | null }[];
    }
    const byUser = new Map<string, Member>();
    for (const r of rows) {
      let m = byUser.get(r.userId);
      if (!m) {
        m = {
          userId: r.userId,
          name: r.userName,
          email: r.userEmail,
          avatarUrl: r.userAvatar,
          connections: [],
        };
        byUser.set(r.userId, m);
      }
      if (r.kind && r.status === "connected") {
        m.connections.push({
          kind: r.kind,
          status: r.status,
          connectedAt: r.connectedAt?.toISOString() ?? null,
        });
      }
    }
    return c.json({ members: Array.from(byUser.values()) });
  },
);

app.delete("/api/me/connections/:kind", authMiddleware, requireUser, async (c) => {
  const kind = c.req.param("kind");
  if (!isKind(kind)) return jsonError(c, 400, "unknown kind");
  const user = c.get("user");
  const [r] = await db
    .delete(userConnections)
    .where(and(eq(userConnections.userId, user.id), eq(userConnections.kind, kind)))
    .returning();
  if (!r) return notFound(c, "Connection");
  return c.body(null, 204);
});

// ------- Public: OAuth provider callback (no auth — provider hits us) -------

app.get("/api/connections/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const errorParam = c.req.query("error");
  if (errorParam) {
    return c.redirect(postCallbackRedirect(false, "linear", errorParam), 302);
  }
  if (!code || !state) {
    return c.redirect(postCallbackRedirect(false, "linear", "missing_code_or_state"), 302);
  }
  const consumed = consumeState(state);
  if (!consumed) {
    return c.redirect(postCallbackRedirect(false, "linear", "invalid_state"), 302);
  }
  const { userId, kind } = consumed;
  const cfg = oauthByKind[kind];
  const creds = clientCredentials(kind);
  if (!creds) {
    return c.redirect(postCallbackRedirect(false, kind, "not_configured"), 302);
  }
  try {
    const reqUrl = new URL(c.req.url);
    const redirectUri = callbackUrl(`${reqUrl.protocol}//${reqUrl.host}`);
    const tokenPayload = await exchangeCode(kind, code, redirectUri, creds);
    const parsed = (cfg.parseTokenResponse ?? defaultParse)(tokenPayload);
    if (!parsed.accessToken) {
      return c.redirect(postCallbackRedirect(false, kind, "no_access_token"), 302);
    }
    const expiresAt = parsed.expiresIn
      ? new Date(Date.now() + parsed.expiresIn * 1000)
      : null;
    const config = {
      access_token: encryptToken(parsed.accessToken),
      refresh_token: parsed.refreshToken ? encryptToken(parsed.refreshToken) : null,
      account_label: parsed.accountLabel ?? null,
      // Provider-side account id. For Slack this is the user we DM when
      // delivering notifications. Not a secret — stored in clear.
      account_id: parsed.accountId ?? null,
      granted_scopes: parsed.grantedScopes ?? null,
      expires_at: expiresAt?.toISOString() ?? null,
    };
    await db
      .insert(userConnections)
      .values({
        userId,
        kind,
        status: "connected",
        config,
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userConnections.userId, userConnections.kind],
        set: { status: "connected", config, connectedAt: new Date(), updatedAt: new Date() },
      });
    return c.redirect(postCallbackRedirect(true, kind), 302);
  } catch (err) {
    console.error(`[oauth] ${kind} callback failed:`, err);
    return c.redirect(postCallbackRedirect(false, kind, "exchange_failed"), 302);
  }
});

const defaultParse = (raw: Record<string, unknown>): ParsedToken => ({
  accessToken: String(raw.access_token ?? ""),
});

/**
 * POST the auth code to the provider's token endpoint and return the
 * parsed JSON response. Slack returns 200 even on failure (with `ok:
 * false`); the per-provider parseTokenResponse normalizes that into an
 * empty accessToken so the caller catches it.
 */
async function exchangeCode(
  kind: ConnectionKind,
  code: string,
  redirectUri: string,
  creds: { clientId: string; clientSecret: string },
): Promise<Record<string, unknown>> {
  const cfg = oauthByKind[kind];
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Several providers (GitHub, Notion) want JSON-shaped responses.
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`token exchange ${kind} → ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export default app;

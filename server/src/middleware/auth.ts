import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "../db/client";
import { agents } from "../db/schema/agents";
import { agentTaskQueue } from "../db/schema/tasks";
import { personalAccessTokens } from "../db/schema/pats";
import { users } from "../db/schema/users";
import { jsonError } from "../lib/errors";
import { hashPat } from "../lib/pat-token";
import { verifyTaskJwt } from "../lib/task-jwt";

const TASK_JWT_SECRET = process.env.TASK_JWT_SECRET ?? "dev-task-secret-change-me!!!!!!!!";

const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const JWKS = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));

export interface AuthUser {
  id: string;
  supabaseUserId: string;
  email: string;
  name: string;
}

export interface TaskAuth {
  taskId: string;
  agentId: string;
  workspaceId: string;
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
    workspaceId: string;
    memberRole: "owner" | "admin" | "member";
    /** Set by authMiddleware when the request carries a task-scoped JWT
     *  (agora CLI invocations spawned by the daemon for this task). */
    taskAuth?: TaskAuth;
  }
}

// Paths that don't require user auth — daemon endpoints carry their own
// machine-token middleware, webhooks carry an opaque token in the URL, and
// /api/daemon/ws carries the machine token as a query string. Hono leaks
// app.use(...) across sibling sub-apps mounted at "/", so this guard prevents
// authMiddleware (registered on workspace routers) from rejecting requests
// destined for these paths.
const NO_AUTH_PATHS = [
  /^\/api\/daemon(\/|$)/,
  /^\/api\/autopilot\/webhook\//,
  // CLI install + binary download — public, no auth. install.{sh,ps1}
  // are the public installers; one per host platform. Both must bypass
  // auth because they're invoked via `curl | bash` / `iwr | iex` BEFORE
  // the user has any credentials on the box. install.ps1 missing from
  // this regex was the bug Windows users hit (401 on the install fetch).
  /^\/api\/cli\/install\.(sh|ps1)$/,
  /^\/api\/cli\/download\//,
  // CLI pair start + exchange — opaque code is the only credential.
  // The /:code/approve endpoint applies its own authMiddleware so it's
  // not in this bypass list.
  /^\/api\/cli\/pair\/start$/,
  /^\/api\/cli\/pair\/exchange$/,
  /^\/api\/cli\/pair\/[^/]+$/,
];

export const authMiddleware = createMiddleware(async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (NO_AUTH_PATHS.some((re) => re.test(path))) {
    await next();
    return;
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError(c, 401, "Missing authorization token");
  }

  const token = authHeader.slice(7);

  // Machine-token branch — daemon endpoints use a separate middleware
  // (daemonAuthMiddleware). When sub-apps share a parent in Hono, an
  // app.use(authMiddleware) on one sub-app leaks to siblings, so requests
  // bound for /api/daemon/* arrive here too. Pass through silently for
  // agm_ tokens; the daemon middleware downstream will validate and 401
  // if the token doesn't match a runtime.
  if (token.startsWith("agm_")) {
    await next();
    return;
  }

  // Task-JWT branch — agora CLI invocations spawned by the daemon. Each
  // spawned claude/codex process gets a short-lived JWT scoped to one
  // task; the CLI passes it as Bearer to call /api/workspaces/:wsid/issues
  // etc. on behalf of the agent. We verify, look up the agent's owner as
  // a synthetic user, and stash taskAuth so handlers know we're acting
  // for an agent (not a human member).
  try {
    const claims = await verifyTaskJwt(token, TASK_JWT_SECRET);
    const task = await db.query.agentTaskQueue.findFirst({
      where: eq(agentTaskQueue.id, claims.taskId),
    });
    if (!task) return jsonError(c, 401, "Task not found");
    if (task.status !== "running" && task.status !== "dispatched") {
      return jsonError(c, 401, "Task not in active state");
    }
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, claims.agentId) });
    if (!agent) return jsonError(c, 401, "Agent not found");
    // Synthesize a user record so downstream handlers that read c.get("user")
    // keep working. Use the agent's owner if present, otherwise the bare
    // agent id as a stand-in. Issue creation handlers should branch on
    // taskAuth and stamp creatorKind=agent / creatorId=agent.id instead.
    const ownerId = agent.ownerId ?? agent.id;
    const ownerUser = agent.ownerId
      ? await db.query.users.findFirst({ where: eq(users.id, agent.ownerId) })
      : null;
    c.set("user", {
      id: ownerUser?.id ?? ownerId,
      supabaseUserId: ownerUser?.supabaseUserId ?? "",
      email: ownerUser?.email ?? `${agent.name}@agent`,
      name: ownerUser?.name ?? agent.name,
    });
    c.set("taskAuth", {
      taskId: claims.taskId,
      agentId: claims.agentId,
      workspaceId: claims.workspaceId,
    });
    await next();
    return;
  } catch {
    // Not a task JWT — fall through to PAT / Supabase JWT below.
  }

  // PAT branch — Personal Access Token (Bearer pat_xxx)
  if (token.startsWith("pat_")) {
    const hash = hashPat(token);
    const pat = await db.query.personalAccessTokens.findFirst({
      where: eq(personalAccessTokens.tokenHash, hash),
    });
    if (!pat || pat.revoked) return jsonError(c, 401, "Invalid or revoked PAT");
    if (pat.expiresAt && pat.expiresAt < new Date()) return jsonError(c, 401, "PAT expired");
    const patUser = await db.query.users.findFirst({ where: eq(users.id, pat.userId) });
    if (!patUser) return jsonError(c, 401, "PAT user missing");
    // Update lastUsedAt (fire and forget)
    void db
      .update(personalAccessTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(personalAccessTokens.id, pat.id));
    c.set("user", {
      id: patUser.id,
      supabaseUserId: patUser.supabaseUserId ?? "",
      email: patUser.email,
      name: patUser.name,
    });
    await next();
    return;
  }

  let sub: string;
  let email: string;
  let name: string;
  let avatarUrl: string | null;
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: "authenticated",
    });
    if (!payload.sub) return jsonError(c, 401, "Invalid token: missing sub");
    sub = payload.sub;
    email = (payload as any).email ?? "";
    name = (payload as any).user_metadata?.full_name ?? (payload as any).email ?? "Unknown";
    avatarUrl = (payload as any).user_metadata?.avatar_url ?? null;
  } catch {
    return jsonError(c, 401, "Invalid token");
  }

  // Common path: insert by supabase UID, update on UID conflict. If a
  // stale row is keyed by email (user re-signed up after auth.users got
  // rotated, so email exists but bound to a different supabase UID),
  // the INSERT trips the email unique constraint. Catch that and rebind
  // the existing row to the new supabase UID. Email is the verified
  // identity; supabase UID is an opaque pointer that can roll.
  let user: typeof users.$inferSelect | undefined;
  try {
    // On UPDATE we only refresh email + avatar from the JWT — name is a
    // user-editable field via PATCH /api/me, and JWTs from email/password
    // signup carry name = email by default. Without this carve-out, every
    // login would clobber the user's chosen display name back to their
    // email address.
    [user] = await db
      .insert(users)
      .values({ supabaseUserId: sub, email, name, avatarUrl })
      .onConflictDoUpdate({
        target: users.supabaseUserId,
        set: { email, avatarUrl, updatedAt: new Date() },
      })
      .returning();
  } catch (err) {
    // Drizzle wraps the postgres error; the original error sits on .cause
    // with .code = "23505" (unique_violation) and .constraint_name set.
    // The supabase-UID conflict is already handled by onConflictDoUpdate,
    // so the only constraint that can land here is user_email_unique.
    const cause = (err as { cause?: { code?: string; constraint_name?: string } }).cause;
    if (cause?.code !== "23505" || cause?.constraint_name !== "user_email_unique") {
      throw err;
    }
    // Same name-preservation rule as the UID-conflict path above: a stale
    // row that was bound to a recycled supabase UID is still owned by the
    // same human, so don't stomp on the display name they may have set.
    [user] = await db
      .update(users)
      .set({ supabaseUserId: sub, avatarUrl, updatedAt: new Date() })
      .where(eq(users.email, email))
      .returning();
  }

  if (!user) return jsonError(c, 500, "User record unavailable");
  c.set("user", {
    id: user.id,
    supabaseUserId: sub,
    email: user.email,
    name: user.name,
  });

  await next();
});

/**
 * Owner-only paths — any of these mutate or read the human's personal
 * account (profile, PATs, notification prefs, OAuth connections, feedback,
 * personal invitations inbox). Agent task tokens authenticate as the
 * agent's owner via authMiddleware, so without an explicit gate an agent
 * spawned in chat could rotate the owner's PAT or disconnect their
 * GitHub.
 *
 * Listed here (not enforced by mounting `app.use(requireUser)` inside
 * each sub-app) because every sub-app is mounted at `/` and Hono leaks
 * `app.use()` middleware across siblings — so a file-scoped `app.use(
 * requireUser)` on me.ts ends up rejecting every agent-token call to
 * /api/workspaces/:wsid/issues, /comments, /agents, and so on. We
 * already follow this same path-whitelist pattern for authMiddleware
 * (NO_AUTH_PATHS) and workspaceMiddleware (NO_WORKSPACE_PATHS); the
 * leak is documented in routes/index.ts.
 */
const REQUIRE_USER_PATHS: RegExp[] = [
  /^\/api\/me(\/|$)/,
  /^\/api\/invitations(\/|$)/,
  /^\/api\/feedback(\/|$)/,
  /^\/api\/connections\/[^/]+\/start(\/|$)/,
];

export const requireUser = createMiddleware(async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (!REQUIRE_USER_PATHS.some((re) => re.test(path))) {
    await next();
    return;
  }
  if (c.get("taskAuth")) {
    return jsonError(
      c,
      403,
      "Agent tokens cannot access owner-scoped endpoints. This call must be made by a human user (Supabase session or PAT).",
    );
  }
  await next();
});

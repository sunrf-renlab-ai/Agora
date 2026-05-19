import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import activityRouter from "./activity";
import agentsRouter from "./agents";
import attachmentsRouter from "./attachments";
import autopilotWebhookRouter from "./autopilot-webhook";
import autopilotsRouter from "./autopilots";
import chatRouter from "./chat";
import cliDistRouter from "./cli-dist";
import cliPairRouter from "./cli-pair";
import commentsRouter from "./comments";
import daemonRouter from "./daemon";
import daemonWsRouter from "./daemon-ws";
import skillSedimentRouter from "./skill-sediment";
import dependenciesRouter from "./dependencies";
import feedbackRouter from "./feedback";
import health from "./health";
import inboxRouter from "./inbox";
import invitationsRouter from "./invitations";
import issuesRouter from "./issues";
import labelsRouter from "./labels";
import me from "./me";
import membersRouter from "./members";
import notificationPreferencesRouter from "./notification-preferences";
import patsRouter from "./pats";
import pinsRouter from "./pins";
import projectsRouter from "./projects";
import quickCreateRouter from "./quick-create";
import reactionsRouter from "./reactions";
import runtimeLocalSkillsRouter from "./runtime-local-skills";
import runtimesRouter from "./runtimes";
import connectionsRouter from "./connections";
import knowledgeRouter from "./knowledge";
import skillsRouter from "./skills";
import subscribersRouter from "./subscribers";
import tasksRouter from "./tasks";
import workspacesRouter from "./workspaces";
import ws from "./ws";

export function createApp() {
  const app = new Hono();

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3001,http://localhost:3002").split(",");

  app.use(logger());
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "X-Workspace-ID"],
      exposeHeaders: [],
    }),
  );

  // TEMP: leak the error message in dev to speed up debugging. Revert to
  // generic "Internal Server Error" before any deploy.
  // Log unhandled exceptions to server stderr with full context
  // (method, path, stack, postgres error code/constraint when available),
  // but return only a generic body to clients so we don't leak SQL params.
  app.onError((err, c) => {
    const path = new URL(c.req.url).pathname;
    console.error(`[onError] ${c.req.method} ${path}:`, err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    const cause = (err as { cause?: { code?: string; constraint_name?: string; detail?: string } }).cause;
    if (cause) console.error(`[onError]   pg cause: code=${cause.code} constraint=${cause.constraint_name ?? "-"} detail=${cause.detail ?? "-"}`);
    return c.text("Internal Server Error", 500);
  });

  app.route("/", health);
  app.route("/", ws);

  // -------------------------- Mount-order invariant --------------------------
  // Hono's sub-app middleware leaks to *siblings* mounted at the same root
  // path. A sibling's `app.use(authMiddleware)` or `app.use(workspaceMiddleware)`
  // at file scope fires for any request that enters the parent dispatcher —
  // including requests bound for a later sibling's route. The leakage is
  // mount-order: an earlier sibling can hijack a later sibling's request.
  //
  // Two empirical bugs caused by this:
  //   1. /api/connections/callback was 401'd by a later router's blanket
  //      authMiddleware until connectionsRouter moved up to slot #3.
  //   2. /api/invitations was 400'd by membersRouter's blanket
  //      workspaceMiddleware ("X-Workspace-ID header required") until
  //      invitationsRouter (and friends) moved above the first
  //      workspaceMiddleware-using router.
  //
  // Rule: mount NON-workspace-scoped routers FIRST (any router that does NOT
  // call `app.use(workspaceMiddleware)` at file scope). Then mount the
  // workspace-scoped ones. Inside each band, order is free.

  // ---- User / public-scoped (no workspaceMiddleware) ----
  app.route("/", connectionsRouter);
  app.route("/", me);
  app.route("/", workspacesRouter);
  app.route("/", invitationsRouter);
  app.route("/", patsRouter);
  app.route("/", feedbackRouter);
  app.route("/", notificationPreferencesRouter);
  app.route("/", cliPairRouter);
  app.route("/", cliDistRouter);

  // ---- Workspace-scoped (file-scope workspaceMiddleware) ----
  app.route("/", membersRouter);
  app.route("/", issuesRouter);
  app.route("/", commentsRouter);
  app.route("/", subscribersRouter);
  app.route("/", inboxRouter);
  app.route("/", activityRouter);
  app.route("/", agentsRouter);
  app.route("/", runtimesRouter);
  app.route("/", tasksRouter);
  app.route("/", daemonRouter);
  app.route("/", daemonWsRouter);
  app.route("/", skillSedimentRouter);
  app.route("/", quickCreateRouter);
  app.route("/", autopilotsRouter);
  app.route("/", autopilotWebhookRouter);
  app.route("/", chatRouter);
  app.route("/", projectsRouter);
  app.route("/", skillsRouter);
  app.route("/", knowledgeRouter);
  app.route("/", runtimeLocalSkillsRouter);
  app.route("/", labelsRouter);
  app.route("/", dependenciesRouter);
  app.route("/", reactionsRouter);
  app.route("/", attachmentsRouter);
  app.route("/", pinsRouter);

  return app;
}

import { hostname } from "node:os";
import WebSocket from "ws";
import type { DaemonConfig } from "./config";
import { ChildTracker, killAllChildren } from "./daemon-children";
import { detectClis } from "./detect";
import { type ClaimResponse, buildPrompt } from "./prompts";
import { pickRunner } from "./runner";
import { getSession, saveSession } from "./session-store";
import {
  type SkillBundle,
  applySkillSync,
  defaultSkillBaseDir,
  loadLocalSkillBundle,
  scanLocalSkills,
} from "./skill-fs";
import { TaskMessageBuffer } from "./task-message-buffer";

const VERSION = "0.0.1";
const HB_INTERVAL_MS = 30_000;
const HB_PONG_TIMEOUT_MS = 10_000;

export async function runDaemon(cfg: DaemonConfig): Promise<void> {
  const detected = detectClis();
  console.log("[agorad] detected CLIs:", detected.map((c) => c.kind).join(", ") || "(none)");

  // 1) Register so the server stamps detected_clis + sets online + recovers orphans.
  const regRes = await fetch(`${cfg.serverUrl}/api/daemon/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.machineToken}` },
    body: JSON.stringify({
      name: hostname(),
      daemonVersion: VERSION,
      detectedClis: detected,
      runtimeInfo: { os: process.platform, hostname: hostname() },
    }),
  });
  if (!regRes.ok) throw new Error(`register failed: ${regRes.status} ${await regRes.text()}`);
  console.log(`[agorad] registered runtime ${cfg.runtimeId}`);

  // 2) HTTP heartbeat (existing)
  const httpHeartbeat = setInterval(async () => {
    try {
      await fetch(`${cfg.serverUrl}/api/daemon/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.machineToken}`,
        },
        body: JSON.stringify({ detectedClis: detectClis() }),
      });
    } catch (e) {
      console.warn("[agorad] heartbeat error:", (e as Error).message);
    }
  }, HB_INTERVAL_MS);

  // 3) Child tracker + shutdown trap
  const children = new ChildTracker();
  let stop = false;
  const shutdown = async () => {
    if (stop) return;
    stop = true;
    clearInterval(httpHeartbeat);
    console.log(`[agorad] shutting down — ${children.size()} child(ren)`);
    await killAllChildren(children, 5_000);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // 4) WS loop with ping/pong + claim-on-wake.
  const wsUrl = `${cfg.serverUrl.replace(/^http/, "ws")}/api/daemon/ws?runtime_id=${cfg.runtimeId}&token=${encodeURIComponent(cfg.machineToken)}`;

  // Backoff state for sleep-resilient reconnects. Render's free tier sleeps
  // after 15 min of idleness and takes ~30 s to wake; a fixed 3 s retry hot-
  // loops during that window. We back off up to ~60 s and reset whenever a
  // socket stays open long enough to look healthy.
  let backoffMs = 3_000;
  const MAX_BACKOFF_MS = 60_000;
  let lastOpenAt = 0;

  while (!stop) {
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(wsUrl);
      let pongDeadline: ReturnType<typeof setTimeout> | null = null;
      let pingTimer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (pingTimer) clearInterval(pingTimer);
        if (pongDeadline) clearTimeout(pongDeadline);
      };

      ws.on("open", () => {
        lastOpenAt = Date.now();
        console.log("[agorad] WS connected");
        ws.send(
          JSON.stringify({ type: "hello", runtimeId: cfg.runtimeId, daemonVersion: VERSION }),
        );
        // Claim once on connect to drain anything queued while offline.
        void claimAndRun(cfg, children).catch((e) =>
          console.warn("[agorad] claimAndRun error (recovered):", (e as Error).message),
        );

        pingTimer = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.ping();
          if (pongDeadline) clearTimeout(pongDeadline);
          pongDeadline = setTimeout(() => {
            console.warn("[agorad] WS pong timeout — terminating socket to force reconnect");
            ws.terminate();
          }, HB_PONG_TIMEOUT_MS);
        }, HB_INTERVAL_MS);
      });

      ws.on("pong", () => {
        if (pongDeadline) {
          clearTimeout(pongDeadline);
          pongDeadline = null;
        }
      });

      ws.on("message", (data) => {
        try {
          const frame = JSON.parse(String(data));
          if (frame.type === "task.available" && frame.runtimeId === cfg.runtimeId) {
            void claimAndRun(cfg, children).catch((e) =>
              console.warn("[agorad] claimAndRun error (recovered):", (e as Error).message),
            );
          } else if (frame.type === "skill.sync" && frame.runtimeId === cfg.runtimeId) {
            void handleSkillSync(
              cfg,
              (frame.bundles as SkillBundle[]) ?? [],
              (frame.removeNames as string[]) ?? [],
            );
          } else if (frame.type === "skill.discover" && frame.runtimeId === cfg.runtimeId) {
            void handleSkillDiscover(
              cfg,
              String(frame.requestId),
              frame.kind === "import" ? "import" : "list",
              typeof frame.skillKey === "string" ? frame.skillKey : undefined,
            );
          }
        } catch (e) {
          // Don't tear down the WS loop on a bad frame — just log a
          // breadcrumb so a stuck/garbled server is debuggable. Truncate
          // both sides: frames can be huge, errors can be huge.
          const raw = String(data).slice(0, 200);
          console.debug(
            `[agorad] WS frame parse error: ${(e as Error).message.slice(0, 200)} | raw=${raw}`,
          );
        }
      });

      ws.on("close", () => {
        cleanup();
        if (stop) return resolve();
        // If the socket stayed up for ≥30 s the server is healthy — reset
        // backoff so the next blip retries quickly. Short-lived sockets
        // (likely Render cold-start failures) keep escalating.
        if (lastOpenAt && Date.now() - lastOpenAt >= 30_000) backoffMs = 3_000;
        console.log(`[agorad] WS closed; reconnect in ${Math.round(backoffMs / 1000)}s`);
        const wait = backoffMs;
        backoffMs = Math.min(Math.round(backoffMs * 1.8), MAX_BACKOFF_MS);
        setTimeout(resolve, wait);
      });
      ws.on("error", (e) => console.warn("[agorad] WS error:", (e as Error).message));
    });
  }
}

async function claimAndRun(cfg: DaemonConfig, children: ChildTracker): Promise<void> {
  const claim = await fetch(`${cfg.serverUrl}/api/daemon/runtimes/${cfg.runtimeId}/tasks/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.machineToken}` },
    body: "{}",
  });
  if (claim.status === 204) return;
  if (!claim.ok) {
    console.warn(`[agorad] claim failed: ${claim.status}`);
    return;
  }
  const cr = (await claim.json()) as ClaimResponse;
  console.log(`[agorad] claimed task ${cr.task.id} (agent ${cr.agent.name})`);
  // Tell server we started.
  await fetch(`${cfg.serverUrl}/api/daemon/tasks/${cr.task.id}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.machineToken}` },
    body: JSON.stringify({}),
  });
  const sessionKey = cr.task.issueId ?? cr.task.chatSessionId;
  const localSession = await getSession(cr.agent.id, sessionKey);
  const priorSessionId = cr.task.priorSession?.session_id ?? localSession?.sessionId ?? null;
  const priorWorkDir = cr.task.priorSession?.work_dir ?? localSession?.workDir ?? null;
  // Buffer per-run agent messages and stream them to the server in batches.
  // We start the timer here and flush before posting /complete /fail so the
  // web's task timeline is never missing the tail of a run.
  const msgBuf = new TaskMessageBuffer(cfg, cr.task.id);
  msgBuf.start();
  try {
    const runner = pickRunner(cr.agent.cliKind);
    // Build the durable runtime config context. This gets rendered into
    // CLAUDE.md inside the agent workdir before the CLI spawns; the
    // per-turn prompt stays thin.
    const taskContext = {
      agentId: cr.agent.id,
      agentName: cr.agent.name,
      agentInstructions: cr.agent.instructions,
      agentSkills: cr.agentSkills,
      knowledgeDocs: cr.knowledgeDocs,
      teamAgents: cr.teamAgents,
      issueId: cr.task.issueId ?? undefined,
      triggerCommentId: cr.task.triggerCommentId ?? undefined,
      chatSessionId: cr.task.chatSessionId ?? undefined,
      quickCreatePrompt: cr.task.quickCreatePrompt ?? undefined,
      autopilotRunId: cr.task.autopilotRunId ?? undefined,
      autopilotId: cr.task.autopilotId ?? undefined,
      autopilotTitle: cr.task.autopilotTitle ?? undefined,
      autopilotDescription: cr.task.autopilotDescription ?? undefined,
      autopilotSource: cr.task.autopilotSource ?? undefined,
      autopilotTriggerPayload: cr.task.autopilotTriggerPayload ?? undefined,
      repos: cr.repos,
      projectId: cr.projectId ?? undefined,
      projectTitle: cr.projectTitle ?? undefined,
      projectResources: cr.projectResources.map((r) => ({
        resourceType: r.resourceType,
        resourceRef: r.resourceRef,
        label: r.label ?? undefined,
      })),
    };
    let prompt: string;
    try {
      prompt = buildPrompt(cr.task, cr.agent, cr.issue);
    } catch (e) {
      // Prompt render errors fail the attempt cleanly with a
      // structured error_kind so the server can decide retry semantics.
      msgBuf.stop();
      await msgBuf.flush();
      await fetch(`${cfg.serverUrl}/api/daemon/tasks/${cr.task.id}/fail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.machineToken}`,
        },
        body: JSON.stringify({
          error: (e as Error).message,
          failureReason: "agent_error",
          errorKind: "prompt_render_error",
        }),
      });
      return;
    }
    const result = await runner.run({
      cliKind: cr.agent.cliKind,
      taskId: cr.task.id,
      agentId: cr.agent.id,
      workspaceId: cr.task.workspaceId,
      serverUrl: cfg.serverUrl,
      taskToken: cr.taskToken,
      prompt,
      priorSessionId,
      priorWorkDir,
      customEnv: cr.agent.customEnv,
      customArgs: cr.agent.customArgs,
      model: cr.agent.model,
      // When this is a quick-create task, the agora CLI auto-stamps
      // origin_type=quick_create + origin_id=<task_id> on whatever issue
      // it files, so the server's complete handler can find it for the
      // inbox notification.
      quickCreateTaskId: cr.task.originType === "quick_create" ? cr.task.id : null,
      parentTaskId: cr.task.parentTaskId ?? null,
      githubToken: cr.githubToken ?? null,
      taskContext,
      onSpawn: (pid) => children.add(pid),
      onExit: (pid) => children.remove(pid),
      onMessage: (m) => msgBuf.enqueue(m),
    });
    if (result.sessionId) {
      await saveSession(cr.agent.id, sessionKey, result.sessionId, result.workDir);
    }
    // Drain the per-run message buffer BEFORE posting the lifecycle event
    // — once /complete fires, the web invalidates and may render an empty
    // timeline if the tail hasn't landed yet.
    msgBuf.stop();
    await msgBuf.flush();
    if (result.status === "completed") {
      const replyBody = cr.task.chatSessionId
        ? { reply: result.lastMessage ?? result.stdout.trim().slice(-50_000) }
        : {};
      await fetch(`${cfg.serverUrl}/api/daemon/tasks/${cr.task.id}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.machineToken}`,
        },
        body: JSON.stringify({
          result: { exitCode: result.exitCode, ...replyBody },
          sessionId: result.sessionId,
          workDir: result.workDir,
          usage: result.usage,
        }),
      });
    } else {
      await fetch(`${cfg.serverUrl}/api/daemon/tasks/${cr.task.id}/fail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.machineToken}`,
        },
        body: JSON.stringify({
          error: result.error ?? `exit ${result.exitCode}`,
          failureReason: "agent_error",
          sessionId: result.sessionId,
          workDir: result.workDir,
          usage: result.usage,
        }),
      });
    }
  } catch (e) {
    msgBuf.stop();
    await msgBuf.flush();
    // Outer catch: daemon-side infra failures (network blip during /start,
    // JSON parse error on claim payload, runner spawn failures, etc.) —
    // these never went through the CLI, so the agent itself didn't error.
    // Tag them as runtime_error so the web can distinguish "agent
    // misbehaved" from "your daemon's stack failed".
    await fetch(`${cfg.serverUrl}/api/daemon/tasks/${cr.task.id}/fail`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.machineToken}` },
      body: JSON.stringify({ error: (e as Error).message, failureReason: "runtime_error" }),
    });
  }
}

async function handleSkillSync(
  cfg: DaemonConfig,
  bundles: SkillBundle[],
  removeNames: string[],
): Promise<void> {
  try {
    const baseDir = await defaultSkillBaseDir();
    await applySkillSync(baseDir, bundles, removeNames);
    console.log(
      `[agorad] skill.sync applied (${bundles.length} bundles, ${removeNames.length} removed)`,
    );
  } catch (e) {
    console.warn("[agorad] skill.sync failed:", (e as Error).message);
  }
}

async function handleSkillDiscover(
  cfg: DaemonConfig,
  requestId: string,
  kind: "list" | "import",
  skillKey: string | undefined,
): Promise<void> {
  if (kind === "list") {
    try {
      const baseDir = await defaultSkillBaseDir();
      const skills = await scanLocalSkills(baseDir);
      await postLocalSkillReport(cfg, "list", requestId, { skills, supported: true });
    } catch (e) {
      await postLocalSkillReport(cfg, "list", requestId, {
        skills: [],
        supported: true,
        error: (e as Error).message,
      });
    }
    return;
  }

  if (!skillKey) {
    await postLocalSkillReport(cfg, "import", requestId, { error: "missing skillKey" });
    return;
  }
  try {
    const baseDir = await defaultSkillBaseDir();
    const skill = await loadLocalSkillBundle(baseDir, skillKey);
    await postLocalSkillReport(cfg, "import", requestId, { skill });
  } catch (e) {
    await postLocalSkillReport(cfg, "import", requestId, { error: (e as Error).message });
  }
}

async function postLocalSkillReport(
  cfg: DaemonConfig,
  kind: "list" | "import",
  requestId: string,
  body: unknown,
): Promise<void> {
  try {
    const res = await fetch(
      `${cfg.serverUrl}/api/daemon/runtimes/${cfg.runtimeId}/local-skills/${kind}/${requestId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.machineToken}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      console.warn(
        `[agorad] local-skills ${kind} report failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
  } catch (e) {
    console.warn(`[agorad] local-skills ${kind} report error:`, (e as Error).message);
  }
}

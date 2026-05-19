import { sqlClient } from "./db/client";
import { websocket } from "./lib/bun-ws";
import { log } from "./lib/log";
import { createApp } from "./routes/index";
import { startScheduler } from "./services/autopilot-scheduler";
import { startRuntimeMonitor } from "./services/runtime-monitor";

const app = createApp();
const port = Number(process.env.PORT ?? 8080);

log.info("Server listening", { url: `http://localhost:${port}` });

if (process.env.AUTOPILOT_SCHEDULER !== "off") {
  startScheduler();
  log.info("Autopilot scheduler started", { tickMs: 60_000 });
}

if (process.env.RUNTIME_MONITOR !== "off") {
  startRuntimeMonitor();
  log.info("Runtime monitor started", { tickMs: 60_000 });
}

// Render redeploys send SIGTERM, then SIGKILL after a grace window. Drain
// the postgres pool so we don't leave half-open connections behind (which
// count against Supabase's tight free-tier limit).
let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Shutdown signal received", { signal });
  try {
    await sqlClient.end({ timeout: 5 });
    log.info("Postgres pool drained");
  } catch (err) {
    log.warn("Postgres drain failed", { err: (err as Error).message });
  }
  process.exit(0);
}
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

export default {
  port,
  fetch: app.fetch,
  websocket,
};

#!/usr/bin/env bun
import { Command } from "commander";
import { loadAuthConfig } from "./auth-config";
import { loadConfig } from "./config";
import { runDaemon } from "./daemon";
import { startDaemonFromPat } from "./daemon-from-pat";
import { runLogin } from "./login";
import { runSetup } from "./setup";

const program = new Command();
program.name("agorad").description("Agora local daemon").version("0.0.1");

// Browser-pair login. Issues a one-time code, opens the browser to the
// approval page, polls for the resulting PAT, persists it.
program
  .command("login")
  .description("Pair this device by approving a code in your browser")
  .option("--server <url>", "Override server URL (defaults to what install.sh wrote)")
  .action(async (opts) => {
    await runLogin({ serverUrl: opts.server });
  });

// Legacy/manual: directly hand-feed UUIDs. Kept so the old onboarding wizard
// (and tests) still work, but new users go through `agorad login`.
program
  .command("setup")
  .description("Manually configure with workspace + runtime + machine-token (advanced)")
  .option("--server <url>")
  .option("--workspace <id>")
  .option("--token <machine-token>")
  .option("--runtime <runtime-id>")
  .action(async (opts) => {
    await runSetup({
      serverUrl: opts.server,
      workspaceId: opts.workspace,
      machineToken: opts.token,
      runtimeId: opts.runtime,
    });
  });

const daemonCmd = program.command("daemon").description("Daemon lifecycle");
daemonCmd
  .command("start")
  .description("Start the long-running daemon")
  .action(async () => {
    // Prefer the modern PAT-driven path. If `agorad login` ran successfully,
    // ~/.agora/auth.json has a token; we use it to discover workspaces and
    // provision a runtime fresh on each start.
    const auth = await loadAuthConfig();
    if (auth?.token) {
      await startDaemonFromPat({ serverUrl: auth.serverUrl, token: auth.token });
      return;
    }
    // Fall back to the legacy `setup` config if the user pre-provisioned
    // (typical of tests + the old onboarding flow).
    const cfg = await loadConfig();
    if (!cfg) {
      console.error(
        "[agorad] not logged in. Run `agorad login` first (or `agorad setup ...` for the manual flow).",
      );
      process.exit(2);
    }
    await runDaemon(cfg);
  });

daemonCmd
  .command("status")
  .description("Print whether the local config exists")
  .action(async () => {
    const auth = await loadAuthConfig();
    if (auth?.token) {
      console.log(`logged in: server=${auth.serverUrl}, token=pat_…${auth.token.slice(-6)}`);
      return;
    }
    const cfg = await loadConfig();
    console.log(
      cfg ? `configured: runtime=${cfg.runtimeId}, server=${cfg.serverUrl}` : "not configured",
    );
  });

await program.parseAsync(process.argv);

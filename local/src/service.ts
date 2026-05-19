import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// Cross-platform control of the agorad background service. The service
// itself is installed by the server-side install.sh — launchd on macOS,
// `systemd --user` on Linux (with a bare-nohup fallback). These helpers
// mirror that install so a user can stop / restart / fully remove the
// daemon without hand-running launchctl.

export type Supervisor = "launchd" | "systemd" | "none";

export interface ServicePaths {
  /** launchd label / kickstart target. */
  label: string;
  /** macOS LaunchAgent plist. */
  plist: string;
  /** systemd --user unit name. */
  unitName: string;
  /** systemd --user unit file. */
  systemdUnit: string;
  /** Daemon log file. */
  logFile: string;
  /** ~/.agora — auth token, daemon config, sessions, logs. */
  configDir: string;
  /** The running agorad binary. */
  binPath: string;
}

const LABEL = "com.agora.daemon";
const UNIT_NAME = "agora-daemon.service";

export function servicePaths(): ServicePaths {
  const home = homedir();
  return {
    label: LABEL,
    plist: join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
    unitName: UNIT_NAME,
    systemdUnit: join(home, ".config", "systemd", "user", UNIT_NAME),
    logFile: join(home, ".agora", "daemon.log"),
    configDir: join(home, ".agora"),
    binPath: process.execPath,
  };
}

/** Which per-user supervisor manages the daemon on this OS. */
export function detectSupervisor(): Supervisor {
  if (process.platform === "darwin") return "launchd";
  if (process.platform === "linux") {
    const probe = spawnSync("systemctl", ["--user", "--version"], { stdio: "ignore" });
    return probe.status === 0 ? "systemd" : "none";
  }
  return "none";
}

// Run a command, best-effort. A non-zero exit is tolerated — these
// actions must be idempotent (stopping an already-stopped service, etc.).
function run(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { stdio: "ignore" });
  return r.status === 0;
}

function uid(): string {
  return String(process.getuid?.() ?? "");
}

/** Kill any stray `agorad daemon` process — a backstop once the
 *  supervisor is gone, so a respawn-supervised daemon can't linger. */
function killStrayDaemon(): void {
  // Don't match this very process if it happens to be `agorad daemon …`.
  spawnSync("pkill", ["-f", "agorad daemon start"], { stdio: "ignore" });
}

export interface ServiceResult {
  supervisor: Supervisor;
  steps: string[];
}

/** Stop the background service. The daemon stays installed. */
export function stopService(): ServiceResult {
  const sup = detectSupervisor();
  const p = servicePaths();
  const steps: string[] = [];
  if (sup === "launchd") {
    run("launchctl", ["bootout", `gui/${uid()}/${p.label}`]);
    steps.push(`launchctl bootout gui/${uid()}/${p.label}`);
  } else if (sup === "systemd") {
    run("systemctl", ["--user", "stop", p.unitName]);
    steps.push(`systemctl --user stop ${p.unitName}`);
  }
  killStrayDaemon();
  steps.push("killed stray agorad daemon process (if any)");
  return { supervisor: sup, steps };
}

/** (Re)start the background service — works from a running or a stopped
 *  state. This is also how you start a service that was stopped. */
export function restartService(): ServiceResult {
  const sup = detectSupervisor();
  const p = servicePaths();
  const steps: string[] = [];
  if (sup === "launchd") {
    if (!existsSync(p.plist)) {
      steps.push("no LaunchAgent installed — run the install command first");
      return { supervisor: sup, steps };
    }
    // bootstrap is a no-op-with-error if already loaded; kickstart -k
    // then force-restarts it.
    run("launchctl", ["bootstrap", `gui/${uid()}`, p.plist]);
    run("launchctl", ["kickstart", "-k", `gui/${uid()}/${p.label}`]);
    steps.push(`launchctl bootstrap + kickstart -k gui/${uid()}/${p.label}`);
  } else if (sup === "systemd") {
    if (!existsSync(p.systemdUnit)) {
      steps.push("no systemd unit installed — run the install command first");
      return { supervisor: sup, steps };
    }
    run("systemctl", ["--user", "restart", p.unitName]);
    steps.push(`systemctl --user restart ${p.unitName}`);
  } else {
    steps.push("no supervisor on this OS — start it manually with `agorad daemon start`");
  }
  return { supervisor: sup, steps };
}

/** Full local removal: stop the service, delete its definition, and
 *  delete ~/.agora and the agorad binary. */
export function uninstallService(): ServiceResult {
  const sup = detectSupervisor();
  const p = servicePaths();
  const steps: string[] = [];

  // 1. Stop + remove the supervisor definition.
  if (sup === "launchd") {
    run("launchctl", ["bootout", `gui/${uid()}/${p.label}`]);
    if (existsSync(p.plist)) {
      rmSync(p.plist, { force: true });
      steps.push(`removed ${p.plist}`);
    }
  } else if (sup === "systemd") {
    run("systemctl", ["--user", "disable", "--now", p.unitName]);
    if (existsSync(p.systemdUnit)) {
      rmSync(p.systemdUnit, { force: true });
      steps.push(`removed ${p.systemdUnit}`);
    }
    run("systemctl", ["--user", "daemon-reload"]);
  }
  killStrayDaemon();
  steps.push("stopped the service + killed stray processes");

  // 2. Remove the config dir (auth token, daemon config, sessions, logs).
  if (existsSync(p.configDir)) {
    rmSync(p.configDir, { recursive: true, force: true });
    steps.push(`removed ${p.configDir}`);
  }

  // 3. Remove the binary — but only if it really is the agorad binary
  //    (under `bun run`, process.execPath is the bun runtime — never
  //    delete that).
  if (basename(p.binPath) === "agorad" && existsSync(p.binPath)) {
    rmSync(p.binPath, { force: true });
    steps.push(`removed ${p.binPath}`);
  } else {
    steps.push(`binary not removed (running via ${p.binPath} — delete it manually)`);
  }

  return { supervisor: sup, steps };
}

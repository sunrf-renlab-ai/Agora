# agorad daemon lifecycle commands — 2026-05-19

## Problem

`agorad` can install + run the daemon but can't stop or remove it. The
CLI has only `daemon start` (the foreground loop the service invokes)
and `daemon status`. The background service is installed by the
server-side `install.sh` (in `cli-dist.ts`) — launchd on macOS,
`systemd --user` on Linux. Both supervise with restart-on-exit
(`KeepAlive` / `Restart`), so `pkill` alone doesn't work — the
supervisor respawns the daemon. Removing it today means hand-running
`launchctl bootout`, deleting the plist, killing processes, and `rm`.

Add three CLI commands so the daemon has a proper lifecycle.

## Commands (added under the existing `daemon` group)

- **`agorad daemon stop`** — stop the background service. The daemon
  stays installed; it just isn't running and won't respawn.
- **`agorad daemon restart`** — (re)start the background service. Works
  whether it's currently running or stopped — this is also how you
  start a service that was stopped. (`daemon start` stays the
  foreground loop; the supervisor invokes it.)
- **`agorad daemon uninstall`** — full local removal: stop the service,
  delete the service definition (plist / systemd unit), delete the
  `~/.agora` config dir (auth token, daemon config, sessions, logs),
  and delete the `agorad` binary itself.

`daemon start` and `daemon status` are unchanged.

## Service model — mirrors `install.sh`

Constants (must match what `install.sh` writes):
- Label: `com.agora.daemon`
- launchd plist: `~/Library/LaunchAgents/com.agora.daemon.plist`
- systemd unit: `~/.config/systemd/user/agora-daemon.service`
- log file: `~/.agora/daemon.log`

`install.sh` picks the supervisor per OS: `darwin` → launchd, `linux` →
systemd (falling back to a bare `nohup` launch when `systemctl` is
absent). The lifecycle commands detect the same way.

| supervisor | stop | (re)start | uninstall extras |
|---|---|---|---|
| **launchd** (macOS) | `launchctl bootout gui/$UID/com.agora.daemon` | `launchctl bootstrap gui/$UID <plist>` then `launchctl kickstart -k gui/$UID/com.agora.daemon` | delete the plist |
| **systemd** (Linux) | `systemctl --user stop agora-daemon.service` | `systemctl --user restart agora-daemon.service` | `systemctl --user disable`, delete the unit, `daemon-reload` |
| **none** (nohup fallback / no supervisor) | kill the `agorad daemon` process | print a hint to run `agorad daemon start` | — |

Every shelled-out supervisor command is best-effort: a missing service
(already stopped / never installed) is not an error — these commands
must be idempotent. After `stop`/`uninstall`, any stray `agorad daemon`
process is killed as a backstop (the supervisor is gone, so it won't
come back).

Windows (schtasks) is out of scope — `install.sh` is the macOS/Linux
installer; the Windows installer is a separate `install.ps1`.

## Architecture

New module `local/src/service.ts` — cross-platform service control,
isolated from the CLI wiring:

- `servicePaths()` → `{ label, plist, systemdUnit, unitName, logFile,
  configDir, binPath }`. Pure — derived from `os.homedir()` /
  `process.execPath`. Testable.
- `detectSupervisor()` → `"launchd" | "systemd" | "none"`. From
  `process.platform` + `systemctl` availability.
- `stopService()`, `restartService()`, `uninstallService()` — perform
  the table above. Thin shell-outs via `Bun.spawnSync`; each step
  tolerates a non-zero exit (idempotent).

`local/src/index.ts` — three new `daemonCmd.command(...)` entries that
call into `service.ts` and print a short human result.

## Testing

The supervisor shell-outs can't run in CI. Test the pure surface:
`servicePaths()` returns the documented paths; `detectSupervisor()`
returns a valid value for the current platform. The shell-out steps
stay thin enough to read-verify.

## Verification

- `bun run --filter '*' typecheck`, `bun --filter '@agora/daemon' test`
  pass.
- Manual on macOS: `agorad daemon stop` → daemon stops and stays down;
  `agorad daemon restart` → it comes back; `agorad daemon uninstall` →
  plist, `~/.agora`, and the binary are gone, no `agorad` process left.

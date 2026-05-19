import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Hono } from "hono";
import { jsonError } from "../lib/errors";

const app = new Hono();

// Where the cross-compiled agorad binaries live. Built by `bun run --filter
// @agora/daemon build:bin`. Gitignored. Rebuild before shipping.
const DIST_DIR = resolve(import.meta.dir, "../../../local/dist");

// What we actually compile for. Matches `bun build --target=bun-<os>-<arch>`.
const SUPPORTED_TARGETS = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "windows-x64",
]);

function binaryPathFor(osArch: string): string | null {
  if (!SUPPORTED_TARGETS.has(osArch)) return null;
  const suffix = osArch.startsWith("windows-") ? ".exe" : "";
  return resolve(DIST_DIR, `agorad-${osArch}${suffix}`);
}

// `curl -fsSL .../api/cli/install.sh | bash` — detects host, downloads the
// matching binary, drops it in ~/.agora/bin, optionally chains into setup.
//
// The script is intentionally short. It does ONE job: get a runnable
// `agorad` on the user's PATH. The actual login + daemon-start steps the
// user runs by hand right after.
app.get("/api/cli/install.sh", async (c) => {
  // The DAEMON's serverUrl MUST be the Render origin, never the Vercel
  // edge or a custom domain that fronts Vercel — Vercel's `rewrites` only
  // proxy HTTP, not WebSocket upgrade. The web app rewrites /api/* to
  // Render so users can browse from agora.renlab.ai (or any vercel.app
  // domain), but the daemon's WS handshake would 502 there.
  //
  // Mirrors pair/daemon/src/config-store.ts where `DEFAULT.server_url`
  // is hardcoded to the Render orchestrator URL for the same reason.
  //
  // Resolution order:
  //   1. `DAEMON_PUBLIC_URL` env var on Render — set this to the public
  //      Render origin in the dashboard. Lets us re-deploy under a
  //      different service name without editing source.
  //   2. The host the install request actually hit, BUT only if it looks
  //      like a Render onrender.com host. This is the localhost dev path
  //      where DAEMON_PUBLIC_URL is unset.
  //   3. Hardcoded fallback to the production Render URL — last resort
  //      so a fresh `curl ... | bash` against agora.renlab.ai still wires
  //      the daemon to Render rather than to Vercel.
  const serverUrl = resolveDaemonServerUrl(c.req);
  // Optional pair code baked into the URL by the web onboarding page so
  // the install script can fetch a PAT itself without the user running
  // `agorad login`. Validated only loosely here; the exchange endpoint
  // is the source of truth.
  const code = c.req.query("code") ?? "";
  const script = renderInstallScript(serverUrl, code);
  return new Response(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});

const HARDCODED_DAEMON_URL = "https://agora-server-ub50.onrender.com";

function resolveDaemonServerUrl(req: {
  url: string;
  header: (n: string) => string | undefined;
}): string {
  const fromEnv = process.env.DAEMON_PUBLIC_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const inferred = inferServerUrl(req);
  // Allow direct-to-Render hits (localhost dev or anyone curl'ing the
  // Render origin straight) to use that origin. Reject Vercel + custom
  // domains that front Vercel, those will silently break WS for the
  // user. Hardcoded fallback for the bad-host case.
  const host = new URL(inferred).host;
  const isRender = host.endsWith(".onrender.com") || host === "127.0.0.1" || host.startsWith("localhost");
  return isRender ? inferred : HARDCODED_DAEMON_URL;
}

// PowerShell mirror of /api/cli/install.sh for native Windows users.
// Run via: `iwr -useb https://agora.renlab.ai/api/cli/install.ps1 | iex`
// Mirrors the .sh behavior: download primary or GH-mirror fallback, gunzip,
// place at %USERPROFILE%\.agora\bin\agorad.exe, write server.json, optional
// pair-code exchange + Task Scheduler autostart.
app.get("/api/cli/install.ps1", async (c) => {
  const serverUrl = resolveDaemonServerUrl(c.req);
  const code = c.req.query("code") ?? "";
  const script = renderInstallPs1(serverUrl, code);
  return new Response(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});

app.get("/api/cli/download/:target", async (c) => {
  const target = c.req.param("target");
  const path = binaryPathFor(target);
  if (!path) return jsonError(c, 404, `Unsupported target: ${target}`);
  if (!existsSync(path)) {
    return jsonError(
      c,
      503,
      `Binary not built for ${target}. Run 'bun run --filter @agora/daemon build:bin'.`,
    );
  }

  // Serve the pre-gzipped artifact when the client supports it. install.sh
  // uses curl which sends `Accept-Encoding: gzip` by default and decompresses
  // transparently — the user sees the original binary on disk. Saves ~15-25%
  // on darwin (where UPX is unsafe) and stacks with the UPX layer on linux.
  const acceptsGzip = (c.req.header("accept-encoding") ?? "").includes("gzip");
  const gzPath = `${path}.gz`;
  const useGz = acceptsGzip && existsSync(gzPath);
  const servePath = useGz ? gzPath : path;
  const size = (await stat(servePath)).size;
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(size),
    "Content-Disposition": "attachment; filename=agorad",
    // Binary is immutable per deploy. Allow Vercel + Cloudflare edges to
    // cache aggressively. Vary on Accept-Encoding so gzipped + raw
    // requests get separate cache entries.
    "Cache-Control": "public, max-age=300, s-maxage=86400, immutable",
    Vary: "Accept-Encoding",
  };
  if (useGz) headers["Content-Encoding"] = "gzip";
  return new Response(Bun.file(servePath).stream(), { headers });
});

function inferServerUrl(req: { url: string; header: (n: string) => string | undefined }): string {
  // Prefer the public-facing host the user actually hit, so the install
  // script written for prod also works on localhost. Honor X-Forwarded-Proto
  // so we say https:// when the deployment terminates TLS at a load balancer.
  const url = new URL(req.url);
  const proto = req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.header("x-forwarded-host") ?? req.header("host") ?? url.host;
  return `${proto}://${host}`;
}

function renderInstallScript(serverUrl: string, code: string): string {
  // Install strategy: try /usr/local/bin (sudo if needed),
  // fall back to ~/.local/bin (already on PATH on most distros), and only as
  // a last resort drop into ~/.agora/bin and append to shell rc. The goal is
  // that \`agorad\` is callable in a fresh terminal without manual PATH edits.
  //
  // When \`code\` is set, the script also exchanges it for a PAT and writes
  // ~/.agora/auth.json, so the user doesn't need to run \`agorad login\`.
  // The web onboarding generates a pre-approved code and bakes it into the
  // install URL.
  // Defensive sanitization: code only carries [A-Z0-9-]. Anything else
  // turns into an empty string so we don't echo arbitrary attacker input
  // into a shell-interpolated value.
  const safeCode = /^[A-Z0-9-]{0,32}$/.test(code) ? code : "";
  return `#!/usr/bin/env bash
# Agora CLI installer.
# Usage:   curl -fsSL ${serverUrl}/api/cli/install.sh | bash
# Then:    agorad daemon start

set -e

SERVER_URL="${serverUrl}"
PAIR_CODE="${safeCode}"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=x64 ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac
TARGET="$OS-$ARCH"

# Persist the server URL so 'agorad login' knows where to call. Done early
# so even if the binary install fails, the config is in place for a manual
# install retry.
mkdir -p "$HOME/.agora"
echo "{\\"serverUrl\\": \\"$SERVER_URL\\"}" > "$HOME/.agora/server.json"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SRC="$TMP/agorad"

# Download with fallback: try the deploy origin first (always carries the
# binary built from this exact commit), then GitHub Releases (mirror —
# Fastly/CF CDN, often more reachable on networks where Vercel's edge
# IPs are blocked). User can override with AGORA_DOWNLOAD_URL or
# AGORA_DOWNLOAD_MIRROR. \`--connect-timeout 20\` fails fast so we move on
# to the mirror without burning a full 75s default TCP timeout.
PRIMARY="\${AGORA_DOWNLOAD_URL:-$SERVER_URL/api/cli/download/$TARGET}"
MIRROR="\${AGORA_DOWNLOAD_MIRROR:-https://github.com/sunrf-renlab-ai/Agora/releases/download/latest/agorad-$TARGET.gz}"

try_download() {
  local url="$1" out="$2"
  curl -fsSL --connect-timeout 20 --retry 2 --retry-delay 2 --compressed -o "$out" "$url"
}

echo "Downloading agorad ($TARGET)..."
if try_download "$PRIMARY" "$SRC"; then
  :
else
  echo "Primary download failed, trying mirror..."
  if try_download "$MIRROR" "$SRC.gz"; then
    gunzip -c "$SRC.gz" > "$SRC"
  else
    echo "Both primary and mirror failed. Check your network or pass" >&2
    echo "AGORA_DOWNLOAD_URL=https://... before piping into bash." >&2
    exit 1
  fi
fi
chmod +x "$SRC"
# macOS Gatekeeper would otherwise block an unsigned binary downloaded via
# curl. Strip the quarantine attribute; harmless on Linux.
xattr -d com.apple.quarantine "$SRC" 2>/dev/null || true

INSTALL_DIR=""
DEST=""

# An explicit override always wins.
if [ -n "\${AGORA_INSTALL_DIR:-}" ]; then
  mkdir -p "$AGORA_INSTALL_DIR"
  INSTALL_DIR="$AGORA_INSTALL_DIR"
  DEST="$INSTALL_DIR/agorad"
  mv "$SRC" "$DEST"
elif [ -w /usr/local/bin ]; then
  # /usr/local/bin is on PATH for nearly every interactive shell on macOS
  # and most Linux distros. Use it only when already writable (e.g. user
  # owns it via homebrew). We DO NOT escalate to sudo by default — the
  # password prompt mid-install was a UX wart. Set AGORA_INSTALL_DIR or
  # run with sudo yourself if you want /usr/local/bin without owning it.
  INSTALL_DIR="/usr/local/bin"
  DEST="$INSTALL_DIR/agorad"
  mv "$SRC" "$DEST"
fi

if [ -z "$INSTALL_DIR" ]; then
  # User-local fallbacks. ~/.local/bin is conventional and usually on PATH;
  # ~/.agora/bin is the absolute last resort.
  if echo ":$PATH:" | grep -q ":$HOME/.local/bin:"; then
    INSTALL_DIR="$HOME/.local/bin"
  elif [ -d "$HOME/.local/bin" ]; then
    INSTALL_DIR="$HOME/.local/bin"
  else
    INSTALL_DIR="$HOME/.agora/bin"
  fi
  mkdir -p "$INSTALL_DIR"
  DEST="$INSTALL_DIR/agorad"
  mv "$SRC" "$DEST"
fi

# If the install dir isn't on PATH yet, add it to the user's shell rc so the
# next shell session picks it up. Print an explicit hint either way so the
# user can run agorad in *this* shell without restarting.
if ! echo ":$PATH:" | grep -q ":$INSTALL_DIR:"; then
  for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
    if [ -f "$rc" ] && ! grep -qF "$INSTALL_DIR" "$rc"; then
      printf '\\n# Added by Agora installer\\nexport PATH="%s:$PATH"\\n' "$INSTALL_DIR" >> "$rc"
      echo "Appended PATH update to $rc"
    fi
  done
  echo
  echo "Installed to $DEST."
  echo "Run this in your current shell to use 'agorad' immediately:"
  echo "  export PATH=\\"$INSTALL_DIR:\\$PATH\\""
else
  echo
  echo "Installed to $DEST."
fi

# Optional one-shot login + auto-start: if the install URL embedded a
# pre-approved pair code, exchange it now, write ~/.agora/auth.json, and
# install a per-user supervisor (launchd on macOS, systemd --user on
# Linux) so the daemon survives reboots without any manual intervention.
LOG_FILE="$HOME/.agora/daemon.log"
LAUNCHAGENT_PLIST="$HOME/Library/LaunchAgents/com.agora.daemon.plist"
SYSTEMD_UNIT="$HOME/.config/systemd/user/agora-daemon.service"
LABEL="com.agora.daemon"

# Boots the agorad service. macOS path uses launchctl with bootout/bootstrap
# so re-running install.sh cleanly replaces the prior agent (and its old
# machine token). Linux path uses systemctl --user; if systemd isn't
# available we fall back to a plain nohup launch.
install_service() {
  case "$OS" in
    darwin) install_service_launchd ;;
    linux)  install_service_systemd ;;
    *)      install_service_nohup ;;
  esac
}

install_service_launchd() {
  mkdir -p "$(dirname "$LAUNCHAGENT_PLIST")"
  cat > "$LAUNCHAGENT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DEST</string>
    <string>daemon</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$LOG_FILE</string>
  <key>StandardErrorPath</key>
  <string>$LOG_FILE</string>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$HOME/.local/bin</string>
  </dict>
</dict>
</plist>
PLIST
  : > "$LOG_FILE"
  # bootout the existing agent (if any) so we replace cleanly. Errors here
  # are normal on a first install and must not abort the script.
  launchctl bootout "gui/$(id -u)" "$LAUNCHAGENT_PLIST" 2>/dev/null || true
  if launchctl bootstrap "gui/$(id -u)" "$LAUNCHAGENT_PLIST"; then
    launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  else
    return 1
  fi
  # Wait for register so the onboarding page picks up the runtime before
  # we hand control back.
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    sleep 0.5
    grep -q "registered runtime" "$LOG_FILE" 2>/dev/null && return 0
  done
  return 0
}

install_service_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    install_service_nohup
    return $?
  fi
  mkdir -p "$(dirname "$SYSTEMD_UNIT")"
  cat > "$SYSTEMD_UNIT" <<UNIT
[Unit]
Description=Agora local agent runtime
After=network-online.target

[Service]
ExecStart=$DEST daemon start
Restart=on-failure
RestartSec=3
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=default.target
UNIT
  : > "$LOG_FILE"
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable --now agora-daemon.service >/dev/null 2>&1 || return 1
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    sleep 0.5
    grep -q "registered runtime" "$LOG_FILE" 2>/dev/null && return 0
  done
  return 0
}

install_service_nohup() {
  : > "$LOG_FILE"
  if command -v setsid >/dev/null 2>&1; then
    setsid "$DEST" daemon start </dev/null >>"$LOG_FILE" 2>&1 &
  else
    nohup "$DEST" daemon start </dev/null >>"$LOG_FILE" 2>&1 &
  fi
  disown 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.5
    grep -q "registered runtime" "$LOG_FILE" 2>/dev/null && return 0
  done
  return 0
}

if [ -n "$PAIR_CODE" ]; then
  echo
  echo "Pairing this device..."
  RESP="$(curl -fsS -X POST -H 'Content-Type: application/json' \\
    -d "{\\"code\\": \\"$PAIR_CODE\\"}" \\
    "$SERVER_URL/api/cli/pair/exchange" || true)"
  TOKEN="$(printf '%s' "$RESP" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')"
  if [ -n "$TOKEN" ]; then
    umask 077
    printf '{"serverUrl": "%s", "token": "%s"}\\n' "$SERVER_URL" "$TOKEN" \\
      > "$HOME/.agora/auth.json"
    echo "Paired."
    echo
    echo "Installing background service..."
    if install_service; then
      case "$OS" in
        darwin)
          echo "Service installed: $LAUNCHAGENT_PLIST"
          echo "Manage with:  launchctl kickstart|stop gui/\\$(id -u)/$LABEL"
          ;;
        linux)
          echo "Service installed: $SYSTEMD_UNIT"
          echo "Manage with:  systemctl --user start|stop|status agora-daemon"
          ;;
        *)
          echo "Daemon running (no supervisor — restart manually after reboot)."
          ;;
      esac
      echo "Logs: $LOG_FILE"
      echo
      echo "Switch back to your browser — the workspace should activate any moment."
    else
      echo "Service install failed. See $LOG_FILE for details."
      echo "Recover with:  agorad daemon start"
    fi
  else
    echo "Pair exchange failed; you'll need to run 'agorad login' yourself."
    echo
    echo "Next:"
    echo "  agorad login            # opens a browser to pair this device"
    echo "  agorad daemon start     # starts the agent runtime"
  fi
else
  echo
  echo "Next:"
  echo "  agorad login            # opens a browser to pair this device"
  echo "  agorad daemon start     # starts the agent runtime"
fi
`;
}

function renderInstallPs1(serverUrl: string, code: string): string {
  // Windows install path. Differences vs install.sh worth noting:
  //   - Default install dir is %USERPROFILE%\.agora\bin (added to User PATH
  //     via [Environment]::SetEnvironmentVariable so new terminals see it).
  //     We do NOT touch %SystemRoot% or HKLM — keeps the installer
  //     non-elevated.
  //   - Supervisor is a Task Scheduler job triggered AtLogon (closest analog
  //     to launchd/systemd --user). schtasks.exe ships with every Windows
  //     install and doesn't require admin for AtLogon-only triggers.
  //   - Gunzip in PowerShell uses System.IO.Compression.GzipStream — works
  //     on any Windows with .NET Framework 4.5+ (i.e. Windows 7 SP1+).
  //
  // Same pair-code sanitization as renderInstallScript.
  const safeCode = /^[A-Z0-9-]{0,32}$/.test(code) ? code : "";
  return `# Agora CLI installer (Windows).
# Usage (PowerShell or cmd — wrapped form works in both):
#   powershell -NoProfile -Command "iwr -useb '${serverUrl}/api/cli/install.ps1' | iex"
# In PowerShell directly:
#   iwr -useb ${serverUrl}/api/cli/install.ps1 | iex
# Then:   agorad daemon start
$ErrorActionPreference = "Stop"

$ServerUrl = "${serverUrl}"
$PairCode  = "${safeCode}"

# Bun --compile only ships windows-x64 today; bail on 32-bit / ARM. Users
# on Windows ARM (Surface Pro X et al) can run x64 binaries via Microsoft
# Prism emulation, but at >2x latency for our use case — we surface the
# limitation rather than silently degrade.
$Arch = $env:PROCESSOR_ARCHITECTURE
if ($Arch -ne "AMD64") {
  Write-Host "Unsupported arch: $Arch. Agora ships windows-x64 only today." -ForegroundColor Red
  exit 1
}
$Target = "windows-x64"

$AgoraDir = Join-Path $env:USERPROFILE ".agora"
New-Item -ItemType Directory -Force -Path $AgoraDir | Out-Null
"@{ serverUrl = '$ServerUrl' } | ConvertTo-Json" | Out-Null
$ServerJson = @{ serverUrl = $ServerUrl } | ConvertTo-Json -Compress
Set-Content -Path (Join-Path $AgoraDir "server.json") -Value $ServerJson -Encoding utf8

$Tmp = Join-Path $env:TEMP "agora-install-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
$GzPath  = Join-Path $Tmp "agorad.exe.gz"
$ExePath = Join-Path $Tmp "agorad.exe"

# Download with fallback: server route first (binary built from this exact
# commit, but only reachable if the user can hit our origin), then GitHub
# Releases mirror (Fastly/CF CDN, often more reachable on networks where
# Vercel edge IPs are blocked).
$Primary = if ($env:AGORA_DOWNLOAD_URL) { $env:AGORA_DOWNLOAD_URL } else { "$ServerUrl/api/cli/download/$Target" }
$Mirror  = if ($env:AGORA_DOWNLOAD_MIRROR) { $env:AGORA_DOWNLOAD_MIRROR } else { "https://github.com/sunrf-renlab-ai/Agora/releases/download/latest/agorad-$Target.exe.gz" }

function Invoke-Download($Url, $Out) {
  try {
    Invoke-WebRequest -Uri $Url -OutFile $Out -UseBasicParsing -TimeoutSec 60
    return $true
  } catch {
    return $false
  }
}

Write-Host "Downloading agorad ($Target)..."
if (-not (Invoke-Download $Primary $GzPath)) {
  Write-Host "Primary download failed, trying mirror..."
  if (-not (Invoke-Download $Mirror $GzPath)) {
    Write-Host "Both primary and mirror failed. Check your network or set" -ForegroundColor Red
    Write-Host "AGORA_DOWNLOAD_URL=https://... before re-running." -ForegroundColor Red
    exit 1
  }
}

# Gunzip the binary — System.IO.Compression.GzipStream is in the .NET
# Framework base class library, no extra modules required.
Add-Type -AssemblyName System.IO.Compression
$inFs  = [System.IO.File]::OpenRead($GzPath)
$gz    = New-Object System.IO.Compression.GzipStream($inFs, [System.IO.Compression.CompressionMode]::Decompress)
$outFs = [System.IO.File]::OpenWrite($ExePath)
$gz.CopyTo($outFs)
$outFs.Dispose(); $gz.Dispose(); $inFs.Dispose()

$InstallDir = if ($env:AGORA_INSTALL_DIR) { $env:AGORA_INSTALL_DIR } else { Join-Path $AgoraDir "bin" }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Dest = Join-Path $InstallDir "agorad.exe"
# If the daemon is already running from this path, Move-Item will fail.
# Try to stop the scheduled task first; ignore errors when no task exists.
schtasks.exe /End /TN "AgoraDaemon" 2>$null | Out-Null
Move-Item -Force -Path $ExePath -Destination $Dest

# Add the install dir to the User PATH so a fresh terminal sees \`agorad\`
# without manual setup. Compare against existing UserPath; only append once.
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $UserPath) { $UserPath = "" }
if (($UserPath.Split(';') -notcontains $InstallDir)) {
  $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
  [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
  # Surface to the CURRENT session too so \`agorad ...\` works right after.
  $env:Path = "$env:Path;$InstallDir"
  Write-Host "Added $InstallDir to your User PATH."
}

Write-Host ""
Write-Host "Installed to $Dest." -ForegroundColor Green
Write-Host ""

function Install-Service {
  param([string]$Exe)
  # AtLogon trigger runs as the user without admin rights. /F replaces any
  # existing AgoraDaemon task with the new exe path. /RL LIMITED keeps the
  # task in the user context (vs HIGHEST which would prompt for elevation).
  schtasks.exe /Create /SC ONLOGON /TN "AgoraDaemon" /TR "\`"$Exe\`" daemon start" /RL LIMITED /F | Out-Null
  if ($LASTEXITCODE -ne 0) { return $false }
  schtasks.exe /Run /TN "AgoraDaemon" | Out-Null
  return $true
}

if ($PairCode) {
  Write-Host "Pairing this device..."
  try {
    $Resp = Invoke-RestMethod -Method Post -Uri "$ServerUrl/api/cli/pair/exchange" -Body (@{ code = $PairCode } | ConvertTo-Json) -ContentType "application/json"
    $Token = $Resp.token
  } catch { $Token = $null }

  if ($Token) {
    $AuthJson = @{ serverUrl = $ServerUrl; token = $Token } | ConvertTo-Json -Compress
    Set-Content -Path (Join-Path $AgoraDir "auth.json") -Value $AuthJson -Encoding utf8
    Write-Host "Paired."
    Write-Host ""
    Write-Host "Installing background service..."
    if (Install-Service -Exe $Dest) {
      Write-Host "Service installed (Task Scheduler: AgoraDaemon)."
      Write-Host "Manage with:  schtasks /End|/Run /TN AgoraDaemon"
      Write-Host ""
      Write-Host "Switch back to your browser — the workspace should activate any moment."
    } else {
      Write-Host "Service install failed. Start manually with:  agorad daemon start" -ForegroundColor Yellow
    }
  } else {
    Write-Host "Pair exchange failed; run 'agorad login' yourself." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Next:"
    Write-Host "  agorad login            # opens a browser to pair this device"
    Write-Host "  agorad daemon start     # starts the agent runtime"
  }
} else {
  Write-Host "Next:"
  Write-Host "  agorad login            # opens a browser to pair this device"
  Write-Host "  agorad daemon start     # starts the agent runtime"
}

Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
`;
}

export default app;

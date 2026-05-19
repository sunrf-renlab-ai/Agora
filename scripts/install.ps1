# Static Agora CLI installer — mirror copy hosted on GitHub Releases.
# Use this URL when the primary (https://agora.renlab.ai/api/cli/install.ps1)
# is unreachable on your network:
#
#   iwr -useb https://github.com/sunrf-renlab-ai/Agora/releases/download/latest/install.ps1 | iex
#
# Downloads the matching agorad binary from the same GitHub Release,
# installs it to %USERPROFILE%\.agora\bin (no admin), and writes
# %USERPROFILE%\.agora\server.json pointing at the production server.
# You still need to pair the device by running `agorad login` after
# install — that command opens a browser and walks you through it.
$ErrorActionPreference = "Stop"

$ServerUrl   = if ($env:AGORA_SERVER_URL) { $env:AGORA_SERVER_URL } else { "https://agora.renlab.ai" }
$MirrorBase  = if ($env:AGORA_DOWNLOAD_MIRROR_BASE) { $env:AGORA_DOWNLOAD_MIRROR_BASE } else { "https://github.com/sunrf-renlab-ai/Agora/releases/download/latest" }

$Arch = $env:PROCESSOR_ARCHITECTURE
if ($Arch -ne "AMD64") {
  Write-Host "Unsupported arch: $Arch. Agora ships windows-x64 only today." -ForegroundColor Red
  exit 1
}
$Target = "windows-x64"

$AgoraDir = Join-Path $env:USERPROFILE ".agora"
New-Item -ItemType Directory -Force -Path $AgoraDir | Out-Null
$ServerJson = @{ serverUrl = $ServerUrl } | ConvertTo-Json -Compress
Set-Content -Path (Join-Path $AgoraDir "server.json") -Value $ServerJson -Encoding utf8

$Tmp = Join-Path $env:TEMP "agora-install-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
$GzPath  = Join-Path $Tmp "agorad.exe.gz"
$ExePath = Join-Path $Tmp "agorad.exe"

Write-Host "Downloading agorad ($Target) from GitHub mirror..."
Invoke-WebRequest -Uri "$MirrorBase/agorad-$Target.exe.gz" -OutFile $GzPath -UseBasicParsing -TimeoutSec 60

# Gunzip via System.IO.Compression.GzipStream (ships with .NET Framework
# 4.5+, i.e. every Windows 7 SP1+ box). Avoids needing 7-Zip / external
# tools just to ungzip a single file.
Add-Type -AssemblyName System.IO.Compression
$inFs  = [System.IO.File]::OpenRead($GzPath)
$gz    = New-Object System.IO.Compression.GzipStream($inFs, [System.IO.Compression.CompressionMode]::Decompress)
$outFs = [System.IO.File]::OpenWrite($ExePath)
$gz.CopyTo($outFs)
$outFs.Dispose(); $gz.Dispose(); $inFs.Dispose()

# Land in %USERPROFILE%\.agora\bin — no admin required. Same default as
# the primary installer.
$InstallDir = if ($env:AGORA_INSTALL_DIR) { $env:AGORA_INSTALL_DIR } else { Join-Path $AgoraDir "bin" }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Dest = Join-Path $InstallDir "agorad.exe"
schtasks.exe /End /TN "AgoraDaemon" 2>$null | Out-Null
Move-Item -Force -Path $ExePath -Destination $Dest

# Append to User PATH so a fresh terminal sees `agorad`. Only mutates if
# the dir isn't already on the User-scope PATH.
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $UserPath) { $UserPath = "" }
if (($UserPath.Split(';') -notcontains $InstallDir)) {
  $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
  [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
  $env:Path = "$env:Path;$InstallDir"
  Write-Host "Added $InstallDir to your User PATH."
}

Write-Host ""
Write-Host "Installed to $Dest." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  $Dest login            # opens a browser to pair this device"
Write-Host "  $Dest daemon start     # starts the agent runtime"

Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue

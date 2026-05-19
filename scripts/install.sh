#!/usr/bin/env bash
# Static Agora CLI installer — mirror copy hosted on GitHub Releases.
# Use this URL when the primary (https://agora.renlab.ai/api/cli/install.sh)
# is unreachable on your network:
#
#   curl -fsSL https://github.com/sunrf-renlab-ai/Agora/releases/download/latest/install.sh | bash
#
# Downloads the matching agorad binary from the same GitHub Release,
# installs it to ~/.local/bin (no sudo, no password), and writes
# ~/.agora/server.json pointing at the production server. You still need
# to pair the device by running `agorad login` after install — that
# command opens a browser and walks you through it.
set -e

SERVER_URL="${AGORA_SERVER_URL:-https://agora.renlab.ai}"
MIRROR_BASE="${AGORA_DOWNLOAD_MIRROR_BASE:-https://github.com/sunrf-renlab-ai/Agora/releases/download/latest}"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=x64 ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac
TARGET="$OS-$ARCH"

mkdir -p "$HOME/.agora"
echo "{\"serverUrl\": \"$SERVER_URL\"}" > "$HOME/.agora/server.json"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SRC="$TMP/agorad"

echo "Downloading agorad ($TARGET) from GitHub mirror..."
curl -fsSL --connect-timeout 20 --retry 2 --retry-delay 2 \
  -o "$SRC.gz" "$MIRROR_BASE/agorad-$TARGET.gz"
gunzip -c "$SRC.gz" > "$SRC"
chmod +x "$SRC"
# macOS Gatekeeper would otherwise block an unsigned binary downloaded via
# curl. Strip the quarantine attribute; harmless on Linux.
xattr -d com.apple.quarantine "$SRC" 2>/dev/null || true

# Land in ~/.local/bin (no sudo) — matches the primary installer's
# default. Append to shell rc if the path isn't on PATH yet.
INSTALL_DIR="${AGORA_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"
DEST="$INSTALL_DIR/agorad"
mv "$SRC" "$DEST"
if ! echo ":$PATH:" | grep -q ":$INSTALL_DIR:"; then
  for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
    if [ -f "$rc" ] && ! grep -qF "$INSTALL_DIR" "$rc"; then
      printf '\n# Added by Agora installer\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$rc"
    fi
  done
fi

echo
echo "Installed to $DEST."
echo
echo "Next steps:"
echo "  $DEST login            # opens a browser to pair this device"
echo "  $DEST daemon start     # starts the agent runtime"
echo
if ! echo ":$PATH:" | grep -q ":$INSTALL_DIR:"; then
  echo "Run this in your current shell to use 'agorad' immediately:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi

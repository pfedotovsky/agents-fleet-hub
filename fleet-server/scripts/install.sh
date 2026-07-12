#!/bin/sh
# fleet-server installer: fetches the latest GitHub release binary for this
# platform and installs it to /usr/local/bin (or $FLEET_SERVER_INSTALL_DIR).
#
#   curl -fsSL https://raw.githubusercontent.com/pfedotovsky/agents-remote-control/main/fleet-server/scripts/install.sh | sh
#
# Optional host dependency: ripgrep (`rg`) enables session search.
set -eu

REPO="${FLEET_SERVER_REPO:-pfedotovsky/agents-remote-control}"
INSTALL_DIR="${FLEET_SERVER_INSTALL_DIR:-/usr/local/bin}"

os=$(uname -s)
arch=$(uname -m)

case "$os" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

case "$arch" in
  arm64|aarch64) cpu="arm64" ;;
  x86_64|amd64) cpu="x64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

if [ "$platform" = "darwin" ] && [ "$cpu" = "x64" ]; then
  echo "No darwin-x64 build is published; use an Apple Silicon Mac or build from source." >&2
  exit 1
fi

target="${platform}-${cpu}"
api="https://api.github.com/repos/${REPO}/releases"
echo "Resolving latest fleet-server release for ${target}..."

asset_url=$(curl -fsSL "$api" |
  grep -o "\"browser_download_url\": *\"[^\"]*server-v[^\"]*\"\|\"browser_download_url\": *\"[^\"]*fleet-server-[^\"]*${target}\.tar\.gz\"" |
  grep "${target}.tar.gz" |
  head -1 |
  sed 's/.*"\(https[^"]*\)"/\1/')

if [ -z "$asset_url" ]; then
  echo "Could not find a fleet-server release asset for ${target}." >&2
  exit 1
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

echo "Downloading $asset_url"
curl -fsSL "$asset_url" -o "$tmpdir/fleet-server.tar.gz"
tar -xzf "$tmpdir/fleet-server.tar.gz" -C "$tmpdir"

echo "Installing to ${INSTALL_DIR}/fleet-server"
if [ -w "$INSTALL_DIR" ]; then
  install -m 755 "$tmpdir/fleet-server" "$INSTALL_DIR/fleet-server"
else
  sudo install -m 755 "$tmpdir/fleet-server" "$INSTALL_DIR/fleet-server"
fi

echo ""
"$INSTALL_DIR/fleet-server" version
echo ""
echo "fleet-server installed. Start it with:"
echo "  fleet-server                # port 3011, data in ~/.fleet-server"
echo "  HOST=:: fleet-server        # IPv6-only hosts"
echo ""
echo "Optional: install ripgrep to enable session search (brew install ripgrep / apt install ripgrep)."
echo "To run as a service, see fleet-server/packaging/ in the repository."

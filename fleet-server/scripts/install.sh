#!/bin/sh
# fleet-server installer: fetches the latest GitHub release binary for this
# platform, installs it to /usr/local/bin (or $FLEET_SERVER_INSTALL_DIR), and
# optionally installs+starts a persistent service.
#
#   curl -fsSL https://raw.githubusercontent.com/pfedotovsky/agents-fleet-hub/main/fleet-server/scripts/install.sh | sh
#   ... | sh -s -- --service        # also install & start a launchd/systemd unit
#
# Options:
#   --service        install and start a persistent service (launchd on macOS,
#                    systemd user unit + linger on Linux), then verify /health
#   --port <n>       service port (default 3011)
#   --host <addr>    bind address (default ::; fallback is built into the binary)
#
# Optional host dependency: ripgrep (`rg`) enables session search.
set -eu

REPO="${FLEET_SERVER_REPO:-pfedotovsky/agents-fleet-hub}"
INSTALL_DIR="${FLEET_SERVER_INSTALL_DIR:-/usr/local/bin}"
SERVICE=0
SERVER_PORT="${SERVER_PORT:-3011}"
SERVER_HOST="${FLEET_SERVER_HOST:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --service) SERVICE=1 ;;
    --port) SERVER_PORT="$2"; shift ;;
    --port=*) SERVER_PORT="${1#*=}" ;;
    --host) SERVER_HOST="$2"; shift ;;
    --host=*) SERVER_HOST="${1#*=}" ;;
    -h|--help)
      sed -n '2,17p' "$0" 2>/dev/null || echo "See script header for usage."
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

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

# Grab every asset download URL across releases (newest first), then take the
# first one for this platform. This skips the Tauri `v*` desktop releases,
# whose assets don't match the fleet-server-*-${target}.tar.gz pattern.
asset_url=$(curl -fsSL "$api" |
  grep -o 'https://[^"]*/releases/download/[^"]*' |
  grep "fleet-server-.*-${target}\.tar\.gz$" |
  head -1)

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

BIN="$INSTALL_DIR/fleet-server"
echo ""
"$BIN" version
echo ""

# ── Bind address ─────────────────────────────────────────────────────
# Leave HOST unset by default: the fleet-server binary binds :: and falls back
# to 0.0.0.0 if IPv6 is unavailable. --host / FLEET_SERVER_HOST still pins it.
detect_host() {
  printf '%s' "$SERVER_HOST"
}

verify_health() {
  if [ "$SERVER_HOST_RESOLVED" = "0.0.0.0" ]; then
    probe_urls="http://127.0.0.1:${SERVER_PORT}/health"
  elif [ "$SERVER_HOST_RESOLVED" = "::" ]; then
    probe_urls="http://[::1]:${SERVER_PORT}/health"
  else
    probe_urls="http://[::1]:${SERVER_PORT}/health http://127.0.0.1:${SERVER_PORT}/health"
  fi
  n=0
  while [ "$n" -lt 15 ]; do
    for probe_url in $probe_urls; do
      if curl -fsS "$probe_url" >/dev/null 2>&1; then
        echo "Health check OK: ${probe_url}"
        return 0
      fi
    done
    n=$((n + 1))
    sleep 1
  done
  echo "WARNING: server did not answer /health on :${SERVER_PORT} within 15s — check the logs." >&2
  return 1
}

install_launchd() {
  label="io.github.pfedotovsky.fleet-server"
  plist="$HOME/Library/LaunchAgents/${label}.plist"
  logdir="$HOME/.fleet-server"
  mkdir -p "$HOME/Library/LaunchAgents" "$logdir"

  host_entry=""
  if [ -n "$SERVER_HOST_RESOLVED" ]; then
    host_entry="    <key>HOST</key>
    <string>${SERVER_HOST_RESOLVED}</string>
"
  fi

  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BIN}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SERVER_PORT</key>
    <string>${SERVER_PORT}</string>
${host_entry}  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${logdir}/fleet-server.log</string>
  <key>StandardErrorPath</key>
  <string>${logdir}/fleet-server.log</string>
</dict>
</plist>
EOF

  launchctl unload "$plist" >/dev/null 2>&1 || true
  launchctl load -w "$plist"
  echo "Installed launchd agent: ${plist}"
  echo "Logs: ${logdir}/fleet-server.log"
}

install_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemd not found. Start manually: ${BIN}" >&2
    echo "  (or add the unit in fleet-server/packaging/ by hand)" >&2
    return 1
  fi
  unitdir="$HOME/.config/systemd/user"
  unit="$unitdir/fleet-server.service"
  mkdir -p "$unitdir"

  host_line=""
  if [ -n "$SERVER_HOST_RESOLVED" ]; then
    host_line="Environment=HOST=${SERVER_HOST_RESOLVED}
"
  fi

  cat > "$unit" <<EOF
[Unit]
Description=fleet-server — agent host server for Agents Hub
After=network.target

[Service]
ExecStart=${BIN}
Restart=on-failure
RestartSec=3
Environment=SERVER_PORT=${SERVER_PORT}
${host_line}
[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable fleet-server
  systemctl --user restart fleet-server
  # Keep the service running after logout (best-effort; needs privileges).
  loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || \
    echo "Note: run 'sudo loginctl enable-linger $(id -un)' to keep the server running after logout."
  echo "Installed systemd user unit: ${unit}"
  echo "Logs: journalctl --user -u fleet-server -f"
}

if [ "$SERVICE" -eq 1 ]; then
  SERVER_HOST_RESOLVED=$(detect_host)
  if [ -n "$SERVER_HOST_RESOLVED" ]; then
    echo "Setting up service on port ${SERVER_PORT} (HOST=${SERVER_HOST_RESOLVED})..."
  else
    echo "Setting up service on port ${SERVER_PORT} (HOST default: :: with IPv4 fallback)..."
  fi
  if [ "$platform" = "darwin" ]; then
    install_launchd
  else
    install_systemd
  fi
  echo ""
  verify_health || true
  echo ""
  echo "fleet-server is running as a service."
  echo "Add http://<this-host>:${SERVER_PORT} in Agents Hub (localhost for this machine)."
else
  echo "fleet-server installed. Start it with:"
  echo "  fleet-server                # port ${SERVER_PORT}, HOST=:: by default with IPv4 fallback"
  echo "  HOST=0.0.0.0 fleet-server   # force IPv4-only binding if needed"
  echo ""
  echo "Or install a persistent service by re-running with --service:"
  echo "  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/fleet-server/scripts/install.sh | sh -s -- --service"
fi

echo ""
echo "Optional: install ripgrep to enable session search (brew install ripgrep / apt install ripgrep)."

# fleet-server

Single-binary agent host server for [Agents Hub](../fleet-hub/). Runs on each
machine where coding agents (Claude Code, Codex) live and exposes the REST +
WebSocket API the hub consumes: projects, sessions, live chat with permission
prompts, files, git, image uploads, session search (SSE), and a `/shell` PTY
terminal.

Fork of the **server component** of
[CloudCLI UI](https://github.com/siteboon/claudecodeui) (1.36.1), trimmed to
the hub's API surface, ported to [Bun](https://bun.sh), and compiled to a
dependency-free executable. License: **AGPL-3.0-or-later** with upstream's
Section 7 additional terms — see [`LICENSE`](LICENSE), [`NOTICE`](NOTICE),
[`UPSTREAM.md`](UPSTREAM.md).

## Install (one command per host, no Node.js/npm)

Install **and start a persistent service** in one command — `--service`
generates and loads a launchd agent (macOS) or systemd user unit (Linux),
uses the server's IPv6-first wildcard bind, records the current shell's
`claude` and `codex` paths in the service when detected, reports whether each
provider is installed and signed in, and verifies `/health`:

```bash
curl -fsSL https://raw.githubusercontent.com/pfedotovsky/agents-fleet-hub/main/fleet-server/scripts/install.sh | sh -s -- --service
```

Plain install (no service — run it yourself):

```bash
curl -fsSL https://raw.githubusercontent.com/pfedotovsky/agents-fleet-hub/main/fleet-server/scripts/install.sh | sh
```

`install.sh` flags: `--service`, `--port <n>` (default 3011), `--host <addr>`,
and `--check-agents` (diagnostics only; no fleet-server download or install).

Provider CLIs remain user-controlled. The installer never installs or signs in
to Claude Code or Codex; it prints the provider-owned install/login command for
each missing step ([Claude setup](https://docs.anthropic.com/en/docs/claude-code/getting-started),
[Codex CLI](https://github.com/openai/codex#installing-and-running-codex-cli)).
Re-run only the readiness check at any time:

```bash
curl -fsSL https://raw.githubusercontent.com/pfedotovsky/agents-fleet-hub/main/fleet-server/scripts/install.sh | sh -s -- --check-agents
```

Or via Homebrew (formula in `packaging/fleet-server.rb`, published through
`pfedotovsky/homebrew-tap`):

```bash
brew install pfedotovsky/tap/fleet-server
fleet-server auth setup
brew services start fleet-server
```

Then add `http://<host>:3011` as a host in Agents Hub and sign in with the
host account. Opening `http://<host>:3011` directly only shows a small status
page; the server does not expose an account-setup UI. For remote access, set
the host credentials locally first:

```bash
fleet-server auth setup
```

Other useful commands:

```bash
fleet-server                 # port 3011, HOST=:: by default, data in ~/.fleet-server
HOST=0.0.0.0 fleet-server    # force IPv4-only binding if needed
fleet-server status          # config + data locations
fleet-server auth status     # whether host login is configured
```

For automation, avoid putting the password in shell history:

```bash
printf '%s\n' "$FLEET_SERVER_PASSWORD" | fleet-server auth setup --username "$USER" --password-stdin
```

Optional host dependency: [`ripgrep`](https://github.com/BurntSushi/ripgrep)
(`rg`) enables cross-session search; without it the server runs fine and the
search endpoint degrades gracefully.

The service units `install.sh --service` writes are also available as static
files in [`packaging/`](packaging/) (systemd user unit, launchd plist) if you
prefer to install them by hand.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVER_PORT` | `3011` | Listen port (upstream CloudCLI uses 3001, so both can run side by side) |
| `HOST` | `::` | Bind address; default falls back to `0.0.0.0` if IPv6 is unavailable |
| `FLEET_SERVER_HOME` | `~/.fleet-server` | Data directory (`auth.db`, `local-server.json`, `.env`) |
| `DATABASE_PATH` | `$FLEET_SERVER_HOME/auth.db` | SQLite database location |
| `CLAUDE_CLI_PATH` | `claude` on PATH | Claude Code binary used for chats |
| `CLAUDE_STARTUP_TIMEOUT_MS` | `45000` | Maximum wait for Claude's first substantive response before surfacing a connection/configuration error |
| `CODEX_CLI_PATH` | newest installed CLI | Explicit Codex binary override; otherwise compares PATH with bundled macOS desktop-app CLIs |
| `CODEX_APP_SERVER_ENABLED` | unset | Experimental: use compatible Codex app-server 0.146.x for model discovery and Codex session turns; flag-off keeps the SDK path, while model lookup failures still fall back to the existing cache |
| `RG_PATH` | `rg` on PATH | ripgrep binary for session search |
| `CONTEXT_WINDOW` | `160000` | Context window size reported to clients |

An `.env` file is read from the current directory, then `$FLEET_SERVER_HOME`.

## Migrating from CloudCLI

On first run with the default data directory, fleet-server **copies**
`~/.cloudcli/auth.db` (users, projects, session index — same schema) to
`~/.fleet-server/auth.db`. The original is never touched, and the default
ports differ, so CloudCLI can keep running during the transition. Chat image
uploads intentionally stay in `~/.cloudcli/assets` because persisted
transcripts reference those paths.

## Divergence from upstream (CloudCLI 1.36.1)

Removed: cursor/opencode providers, taskmaster, plugins, browser-use, voice,
web-push/desktop notifications, settings/credentials UI routes, agent
automation endpoint, self-update, and the bundled SPA (Agents Hub is the
client; `/` serves a minimal landing page). Issue #7 of our upstream catalog
(no `?token=` handoff into the bundled UI) is moot for the same reason.

Runtime: Node → Bun. better-sqlite3 → `bun:sqlite`; node-pty →
`Bun.Terminal`; bcrypt → `Bun.password` (existing `$2b$` hashes keep
working); versions baked at compile time.

Fixed upstream defects (numbering follows
[`../docs/cloudcli-server-issues.md`](../docs/cloudcli-server-issues.md);
commits are prefixed `[fork-fix #N]`):

| # | Fix |
| --- | --- |
| 1 | U+2028/U+2029 in a message no longer orphans the session (JSONL split on `\n` only, per-line error tolerance) |
| 2 | Session indexing is self-healing: mtime-aware rescans + a `failed_scan_files` retry queue |
| 4/5 | Permission mode and "always allow" grants persist per session server-side (`session_settings` table) |
| 6 | `PUT /file` creates missing parent directories |
| 13 | Codex keychain logins detected via `codex login status` fallback |
| 14 | Codex chats spawn the HOST's codex binary (`codexPathOverride`), never an outdated vendored one |
| 15 | Turns completing with zero output emit a synthetic error instead of dying silently |

## Development

```bash
bun install
bun run dev          # interpreted source server, port 3012, data in ~/.fleet-server-dev
bun run typecheck
bun test server
bun run probe:codex-app-server       # sanitized handshake + model-list probe; no thread
bun run probe:codex-app-server-turn  # ephemeral read-only turn; persists no session
bun run build        # compiled binary for this platform (dist/)
bun run scripts/build.ts --all   # full release matrix
```

Port 3011 and `~/.fleet-server` are reserved for the installed/released
fleet-server, so both instances can run at once without sharing a socket or
SQLite database. The Vite development UI on port 5173 discovers source port
3012; packaged Agents Hub builds discover release port 3011. Explicit
`SERVER_PORT` and `FLEET_SERVER_HOME` values still override the development
defaults.

Releases: tag `server-v<semver>` → `.github/workflows/server-release.yml`
builds/tests/publishes. Cherry-picking upstream changes: see
[`UPSTREAM.md`](UPSTREAM.md). Bun-port findings: see
[`docs/bun-port-notes.md`](docs/bun-port-notes.md).

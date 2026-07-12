# agents-fleet-hub

Control coding agents (Claude Code and others) running on remote machines —
projects, sessions, and live agent chat across all your hosts in one UI.

Two parts:

- **[`fleet-hub/`](fleet-hub/)** — a static React SPA with no backend. The
  browser talks directly to the server API on each host.
- **[`fleet-server/`](fleet-server/)** — the per-host server: a single-binary
  fork of the [CloudCLI UI](https://github.com/siteboon/claudecodeui) server
  (no Node.js required on hosts). Stock
  [CloudCLI](https://www.npmjs.com/package/@cloudcli-ai/cloudcli) also works.

**Design goal:** installation of both parts must be as simple as possible —
one command per host for the server, one command for the hub. See
[`docs/installation-simplicity.md`](docs/installation-simplicity.md) for the
current state and roadmap, and "[Toward one-click](#toward-one-click)" below
for what's left.

## Setup

Two things get installed: **fleet-server** on each machine you want to control
(including your own laptop), and the **hub** on the machine you drive from.

### 1. On each host — the agent CLIs + fleet-server

fleet-server drives whatever agent CLIs are already on the host, so install and
log into the ones you want first (skip any you won't use):

```bash
# Claude Code — https://docs.claude.com/en/docs/claude-code
claude          # then sign in once (interactive)

# Codex — https://developers.openai.com/codex/cli
codex login     # keychain login is detected automatically
```

Then install fleet-server (single binary, **no Node.js/npm**) — one command
that installs *and* starts a persistent service on `:3011`:

```bash
# without Homebrew — installs the binary + a launchd/systemd service
# (auto-detects IPv6-only hosts and sets HOST=::)
curl -fsSL https://raw.githubusercontent.com/pfedotovsky/agents-fleet-hub/main/fleet-server/scripts/install.sh | sh -s -- --service

# or with Homebrew (macOS/Linux)
brew install pfedotovsky/tap/fleet-server && brew services start fleet-server
```

Verify it's up: `curl http://localhost:3011/health`. Nothing else to
configure — the account is created from the hub on first connect. Drop
`--service` (or run `fleet-server` yourself instead of `brew services`) if you
just want the binary without a background service. See
[`fleet-server/README.md`](fleet-server/README.md) for env vars, `--port`/
`--host` flags, and migrating an existing CloudCLI host. (Hosts still running
stock CloudCLI on :3001 keep working too.)

**Remote hosts:** make the port reachable — bind all interfaces
(`HOST=:: fleet-server`, or `SERVER_PORT`/reverse proxy) and open the
firewall, or reach it over a VPN/SSH tunnel. Anyone who can reach the port +
sign in can run code as that user, so don't expose it on the open internet
without TLS in front.

### 2. On your machine — the hub

Desktop app (recommended):

```bash
brew install --cask pfedotovsky/tap/agents-hub    # macOS
```

Linux builds and the source/dev-server path are in
[`fleet-hub/README.md`](fleet-hub/README.md) (`npm install && npm run dev` →
http://localhost:5173).

### 3. Connect

In the hub: **Settings (gear)** → add a host with its base URL
(`http://localhost:3011`, or `http://my-vm.example.net:3011`) → sign in. A
brand-new host prompts you to create its single account; after that only the
JWT is stored (in the hub, never the password). Projects and sessions from
that host appear immediately.

## Toward one-click

Already done: **`install.sh --service`** installs and starts a persistent
launchd/systemd unit in one command, and the **hub auto-discovers a localhost
fleet-server/CloudCLI** and offers a one-click "Add". Remaining friction,
roughly highest-leverage first (tracked in [`docs/backlog.md`](docs/backlog.md)):

1. **Signed & notarized desktop app.** If the cask ships an unsigned build,
   macOS Gatekeeper adds a scary right-click-open step. Notarization makes the
   hub install truly one-click. (Windows/Linux signing likewise.)
2. **Agent-CLI bootstrap + clear auth state.** The host still needs `claude` /
   `codex` installed and logged in. Login is interactive per provider, but the
   installer could detect what's missing and print exact next steps, and the
   hub already surfaces "not signed in" (issues #13/#15) — make that a
   first-class, actionable banner rather than a silent empty chat.
3. **Keep hosts current.** Self-update was stripped from the fork; today it's
   a manual `brew upgrade fleet-server`. A tiny "update available" check
   (compare `/health` version to the latest release) or an opt-in periodic
   upgrade would keep a fleet from drifting.
4. **Remote reachability helper.** The hardest part for remote VMs is the
   network (bind address, firewall, TLS). A documented one-liner tunnel, or a
   hub-side "paste this on the VM" snippet, would remove the last manual step.

The current north star: **one command per host** (install + start + a nudge to
log the agent CLIs in) and **one install for the hub** (signed app). The
localhost path is already effectively one-click; remote hosts still need the
network sorted out by hand.

## Security

A host's JWT allows running code as your user on that machine. Tokens live in
your browser's localStorage only — don't host this page anywhere public.

## Licensing

This repository contains two differently-licensed parts:

- **`fleet-server/`** is a fork of the CloudCLI UI server and is licensed
  **AGPL-3.0-or-later** with upstream's Section 7 additional terms — see
  [`fleet-server/LICENSE`](fleet-server/LICENSE),
  [`fleet-server/NOTICE`](fleet-server/NOTICE), and
  [`fleet-server/UPSTREAM.md`](fleet-server/UPSTREAM.md).
- Everything else (including `fleet-hub/`) is separate, independently
  developed work and is not covered by that license. <!-- TODO: pick a
  license for fleet-hub — currently unlicensed. -->

Do not move code across this boundary.

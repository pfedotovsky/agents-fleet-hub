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
current state and roadmap.

## Requirements

- **fleet-server on every host you want to control** — one command, no
  Node.js:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/pfedotovsky/agents-remote-control/main/fleet-server/scripts/install.sh | sh
  fleet-server          # HOST=:: fleet-server on IPv6-only machines
  ```

  No further setup on the host — the hub itself will prompt you to create the
  account on first connect. (Hosts running stock CloudCLI on :3001 keep
  working too.)
- Node.js 20+ locally to run the hub.

## Quick start

```bash
cd fleet-hub
npm install
npm run dev       # http://localhost:5173
```

Open settings (gear in the sidebar), add each host by URL, sign in once per
host. See [`fleet-hub/README.md`](fleet-hub/README.md) for details.

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

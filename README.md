# agents-fleet-hub

Control coding agents (Claude Code and others) running on remote machines —
projects, sessions, and live agent chat across all your hosts in one UI.

The app is **[`fleet-hub/`](fleet-hub/)** — a static React SPA with no backend.
The browser talks directly to the [CloudCLI](https://www.npmjs.com/package/@cloudcli-ai/cloudcli)
API on each host.

## Requirements

- **CloudCLI on every host you want to control** — it is the server side:

  ```bash
  npm install -g @cloudcli-ai/cloudcli
  cloudcli          # HOST=:: cloudcli on IPv6-only machines
  ```

  No further setup on the host — the hub itself will prompt you to create the
  account on first connect.
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

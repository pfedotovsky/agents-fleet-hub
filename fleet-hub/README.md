# Fleet Hub

A multi-host CloudCLI client: projects, sessions, and live agent chat across
several CloudCLI instances (CodEnv VMs + localhost) in one UI. A static React
SPA with no backend — the browser talks to each host's CloudCLI API and chat
WebSocket directly (CloudCLI's CORS is wide open).

## Run

```bash
npm install
npm run dev     # http://localhost:5173
```

Open settings (gear in the sidebar) → add each host: a name, its base URL
(e.g. `http://<env-id>.<dc>.yp-c.yandex.net:3001` or `http://localhost:3001`),
and optionally a username to prefill the login form. Sign in once per host —
only the JWT is kept (localStorage), never the password, and the token slides
forward via CloudCLI's `X-Refreshed-Token` header while the page is open.

## What it does

- **Sidebar**: every host with its projects — pinned (starred) first, then by
  recent activity, long tails collapsed behind "N more". Star toggles persist
  on the host (`toggle-star` API); "recently opened in the hub" is tracked in
  localStorage. "All sessions" is a merged recent-activity feed across hosts.
- **Project view**: the project's sessions (paged), "New session" with a
  provider picker (claude / codex / opencode), and a **Files** button.
- **Chat**: full transcript (history over REST, paged) + live agent chat over
  the host's `/ws` WebSocket — send messages, watch streaming replies and tool
  calls, approve/deny permission requests inline, stop a running agent, pick a
  permission mode (ask / accept edits / plan / bypass) and a **model + effort**
  (from `GET /api/providers/:provider/models`; sent as `options.model/effort`
  in `chat.send`). Assistant replies render as Markdown (GFM tables, code
  blocks with syntax highlighting and a copy button). Tool calls render like
  CloudCLI: Edit/Write as red/green diffs with file badges, Bash as a green
  terminal line with collapsible output, TodoWrite as a checklist with
  progress, Read/Grep/Glob as one-liners. Mid-run reconnects re-attach via
  `chat.subscribe` seq replay.
- **File browser/editor**: per-project tree (`GET /files`, node_modules/.git
  pruned server-side) with a lazy-loaded CodeMirror editor (One Dark, language
  by extension); Cmd+S / Save button writes via `PUT /file`.
- The external-link icon opens the session in that host's own CloudCLI UI
  (requires having signed into that host's page once — its frontend keeps its
  token in its own origin's localStorage with no URL handoff).

## Behavior notes

- Hosts are polled every 12 s (`GET /api/projects?sessionsLimit=5`).
- Transcripts: `GET /api/providers/sessions/:id/messages` (normalized across
  providers; `offset=0` is the newest page). New sessions:
  `POST /api/providers/sessions {provider, projectPath}`, then the first
  `chat.send` starts the agent.
- An unreachable host (hibernated CodEnv VM) shows an offline card with the
  restart hint (`HOST=:: cloudcli`); its last-known sessions stay dimmed as stale.
- Cursor sessions carry a warning badge — ones created from the Cursor IDE have
  no readable store, so transcripts and deep links fail for them. A settings
  toggle hides them.
- Tested against CloudCLI 1.36.1. `messageCount` in its API is hardcoded to 0,
  so the UI does not show message counts.

## Security

A host's JWT allows running code as your user on that machine. Tokens live in
your browser's localStorage only — don't host this page anywhere public.

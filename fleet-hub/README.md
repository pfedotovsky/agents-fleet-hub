# Agents Hub

A multi-host CloudCLI client: projects, sessions, and live agent chat across
several CloudCLI instances (remote VMs + localhost) in one UI. A static React
SPA with no backend — the browser talks to each host's CloudCLI API and chat
WebSocket directly (CloudCLI's CORS is wide open).

## Run

```bash
npm install
npm run dev     # http://localhost:5173
```

Or install the desktop app — the same SPA in a Tauri shell:

```bash
brew install --cask pfedotovsky/tap/agents-hub    # macOS
```

Linux AppImage/deb/rpm are on the
[releases page](https://github.com/pfedotovsky/agents-fleet-hub/releases).
Releases aren't notarized yet; if macOS refuses to open the app, run
`xattr -dr com.apple.quarantine "/Applications/Agents Hub.app"`.
Native development needs Rust: `npm run tauri dev`. A release is cut by
bumping the version in `src-tauri/tauri.conf.json` and pushing a `v*` tag
(CI attaches bundles to the GitHub Release), then updating `version`/`sha256`
in the tap's `Casks/agents-hub.rb`.

Open settings (gear in the sidebar) → add each host: a name, its base URL
(e.g. `http://my-vm.example.net:3001` or `http://localhost:3001`),
and optionally a username to prefill the login form. Sign in once per host —
on a freshly installed CloudCLI the hub offers first-time setup instead
(creates the host's single account via `POST /api/auth/register`). Only the
JWT is kept (localStorage), never the password, and the token slides forward
via CloudCLI's `X-Refreshed-Token` header while the page is open.

## What it does

- **Sidebar**: every host with its projects — pinned (starred) first, then by
  recent activity, long tails collapsed behind "N more". Each project expands
  (chevron) to show its recent chats inline; click one to open it. Star
  toggles persist on the host (`toggle-star` API); "recently opened in the
  hub" is tracked in localStorage. "All sessions" is a merged recent-activity
  feed across hosts. Each chat in the tree is tagged with its provider icon
  (Claude / Codex / …). Hovering a project row reveals a **+** that opens a new
  chat directly — the provider (Claude / Codex) is chosen with a toggle in the
  composer, and the session is created on the first send.
- **Project view**: the project's sessions (paged), "New session" (opens a
  draft chat; provider is picked in the composer), and a **Files** button.
- **Chat**: full transcript (history over REST, paged) + live agent chat over
  the host's `/ws` WebSocket — send messages, watch streaming replies and tool
  calls, approve/deny permission requests inline — with an **Always allow**
  option that remembers the grant per host+project, re-sends it on every
  message (CloudCLI keeps no permission state between sends), and writes it
  through to the project's `.claude/settings.local.json` on the host so
  terminal Claude Code honors it too — stop a running agent, pick a
  permission mode (ask / accept edits / bypass; persisted per host) and a
  **model + effort**
  (from `GET /api/providers/:provider/models`; sent as `options.model/effort`
  in `chat.send`). Assistant replies render as Markdown (GFM tables, code
  blocks with syntax highlighting and a copy button). Tool calls render like
  CloudCLI: Edit/Write as red/green diffs with file badges, Bash as a green
  terminal line with collapsible output, TodoWrite as a checklist with
  progress, Read/Grep/Glob as one-liners. Mid-run reconnects re-attach via
  `chat.subscribe` seq replay. The composer autocompletes `@` file tags from
  the project tree and `/` skills + custom commands (message start only) from
  the host's `.claude` directories — Tab/Enter inserts, and the command is
  sent as plain text for the host's Claude Code binary to expand.
  **Plan mode** is a separate composer toggle (Shift+Tab, persisted per
  host); a finished plan opens in a docked right-hand drawer with
  approve / approve-and-accept-edits / revise buttons.
- **Chat side panels**: two header toggles dock the file browser or the git
  panel to the right of the conversation (Cursor-style) — resizable by
  dragging the edge, choice and width persisted in localStorage.
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
- An unreachable host (hibernated remote VM) shows an offline card with the
  restart hint (`HOST=:: cloudcli`); its last-known sessions stay dimmed as stale.
- Cursor sessions carry a warning badge — ones created from the Cursor IDE have
  no readable store, so transcripts and deep links fail for them. A settings
  toggle hides them.
- Tested against CloudCLI 1.36.1. `messageCount` in its API is hardcoded to 0,
  so the UI does not show message counts.

## Security

A host's JWT allows running code as your user on that machine. Tokens live in
your browser's localStorage only — don't host this page anywhere public.

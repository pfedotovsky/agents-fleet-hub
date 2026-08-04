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

The Vite UI discovers the source fleet-server at `http://localhost:3012`
(`cd ../fleet-server && bun run dev`). That command uses
`~/.fleet-server-dev`; released fleet-server stays on 3011 with
`~/.fleet-server`, so development and Homebrew installations can run
simultaneously. Packaged Agents Hub builds continue to discover the released
server on 3011.

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

Or open it straight from a host — fleet-server serves this same UI at
`http://<host>:3011/fleet-hub/` (the build is embedded in the fleet-server
binary, so there's nothing to install and no code signing). Use it over plain
HTTP on the LAN: a browser tab loaded over HTTPS can't reach an `http://` host
(mixed content).

A fleet-server running on the same machine (port 3011) is **added
automatically on launch and needs no sign-in** — the hub mints a token via
the server's loopback-only `POST /api/auth/local-token` (fleet-server newer
than 0.1.2). Removing it in settings sticks; it won't be re-added.

For every other host, open settings (gear in the sidebar) → add a name, its
base URL (e.g. `http://my-vm.example.net:3001` or `http://localhost:3001`),
and optionally a username to prefill the login form. Sign in once per host —
for remote fleet-server access, first run `fleet-server auth setup` on the
host. On a freshly installed stock CloudCLI host, the hub still offers
first-time setup via `POST /api/auth/register`. Only the JWT is kept
(localStorage), never the password, and the token slides forward via
CloudCLI's `X-Refreshed-Token` header while the page is open. fleet-server's
own root URL is only a status page; it does not expose an account-setup UI.

## What it does

- **Sidebar**: every host with its projects — pinned (starred) first, then by
  recent activity, long tails collapsed behind "N more". Each project expands
  (chevron) to show its recent chats inline; click one to open it. Star
  toggles persist on the host (`toggle-star` API); "recently opened in the
  hub" is tracked in localStorage. "All sessions" is a merged recent-activity
  feed across hosts. Each chat in the tree is tagged with its provider icon
  (Claude / Codex / …). Online project and session rows can be renamed in place
  from their hover actions; project rename is also available beside the project
  header. Names update the feed, project view, sidebar, and an already-open chat
  immediately; blank project names reset to the host default without moving the
  folder. The feed's **New session** action opens a draft whose
  composer chooses any project folder from an online host, or creates/opens an
  arbitrary absolute path through the selected host. Hovering a project row
  still reveals a **+** that opens a draft already bound to that project.
  In either path, the provider (Claude / Codex) is chosen in the composer and
  the session is created on the first send. Each online host also has a lazy
  **Archived projects** list with one-click restore; project archiving never
  removes files or transcripts.
- **Project view**: the project's sessions (paged), "New session" (opens a
  draft chat; provider is picked in the composer), plus **Files**, **Git**, and
  an inline-confirmed **Archive** action. Archiving hides the project and its
  sessions from active navigation but leaves all host data restorable.
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
  in `chat.send`). Existing Claude and Codex sessions show their latest
  persisted context-window occupancy in the header as soon as they open; a
  completed live turn refreshes it. Codex child-agent rollouts stay out of the
  sidebar, project pages, All sessions, archives, and global search; parent
  Agent activity remains visible, and a known child id can still resolve its
  preserved history. Assistant replies render as Markdown (GFM
  tables, code blocks with syntax highlighting and a copy button). Feature-flagged Codex
  app-server turns also stream provider-authored reasoning summaries into one
  collapsed `thinking` row; raw reasoning is not exposed. Tool calls render like
  CloudCLI: Edit/Write as red/green diffs with file badges, Bash as a green
  terminal line with collapsible output (including same-row command lifecycle
  updates from feature-flagged Codex app-server hosts), Codex FileChanges as
  per-file unified diffs that remain visible after completion, Codex WebSearch
  activity as compact query rows that survive history refresh, and Codex MCP
  calls as stable tool rows labelled with their MCP server that also survive a
  reload. Codex collaboration calls render as compact Agent rows for spawning,
  messaging, waiting, resuming, and closing subagents, including after a
  history reload. Live child-agent activity adds compact started/interacted/
  interrupted rows with the child path and remains visible when the completed
  turn reconciles with history. Codex image views render as compact path-only
  rows after completion and reload without forwarding image bytes. Codex
  context compaction renders as a passive one-line marker without exposing
  provider replacement history. TodoWrite renders as a checklist with progress; feature-flagged Codex
  app-server plan updates advance one provider-authored checklist in place and
  keep it visible after the turn completes and after a history reload. Internal
  Code Mode orchestration uses a compact row instead of exposing recorded
  JavaScript as Bash. Read/Grep/Glob render as one-liners.
  Mid-run reconnects
  re-attach via `chat.subscribe` seq replay. The composer autocompletes `@` file tags from
  the project tree and `/` skills + custom commands (message start only) from
  the host's `.claude` directories — Tab/Enter inserts, and the command is
  sent as plain text for the host's Claude Code binary to expand.
  **Plan mode** is a separate composer toggle (Shift+Tab, persisted per
  host), supported for both Claude and Codex. For Claude, a finished plan
  opens in a docked right-hand drawer with
  approve / approve-and-accept-edits / revise buttons. Codex runs read-only
  while planning; when it finishes, a "plan ready" **Build** card appears in
  the transcript to leave plan mode and have it implement. Hosts using the
  experimental app-server adapter also show Codex's effective approval policy
  and sandbox beside the requested mode, including managed-policy overrides.
- **Chat side panels**: two header toggles dock the file browser or the git
  panel to the right of the conversation (Cursor-style) — resizable by
  dragging the edge, choice and width persisted in localStorage.
- **Session views**: switch any session between the structured chat and its
  full live terminal. Settings → Sessions chooses which view opens by default.
  Existing sessions run `claude --resume <id>` / `codex resume <id>` in the
  host's real PTY; a draft starts a new provider CLI in that project folder.
  The terminal stays dark in either app theme so ANSI output remains readable.
- **File browser/editor**: per-project tree (`GET /files`, node_modules/.git
  pruned server-side) with a lazy-loaded CodeMirror editor (One Dark, language
  by extension); Cmd+S / Save button writes via `PUT /file`.
- **Git workspace**: the Changes tab covers status, staging, commits, branches,
  remotes, and per-file diffs. The History tab lists recent commits across
  branches/remotes/tags with refs, author, time, short hash, and file stats;
  select one to inspect its patch and load older history in bounded pages.
- The external-link icon opens the session in that host's own CloudCLI UI
  (requires having signed into that host's page once — its frontend keeps its
  token in its own origin's localStorage with no URL handoff).

## Behavior notes

- Hosts are polled every 12 s (`GET /api/projects?sessionsLimit=5`).
- The global new-session folder selector is built from those poll results and
  lists projects from online hosts only. **Add folder… → Use folder** calls
  `POST /api/projects/create-project {path}` on the chosen host: an existing
  directory is registered, while a missing directory is created only inside
  that server's configured workspace root (the host user's home by default).
  **Clone repository** streams authenticated `GET /api/projects/clone-progress`
  updates for an HTTPS, SSH, or host-local Git source, supports cancellation,
  and selects the registered project immediately on success. Repository
  credentials stay on the host; the form does not collect a token.
- Project archive uses `DELETE /api/projects/:id` without `force`; archived
  projects are fetched lazily from `GET /api/projects/archived` and restored
  through `POST /api/projects/:id/restore`. The hub does not expose permanent
  project deletion.
- Project rename uses `PUT /api/projects/:id/rename {displayName}`. It changes
  only the persisted display name; the host folder path is never renamed or
  moved. Blank input resets to the host's stable default name.
- Transcripts: `GET /api/providers/sessions/:id/messages` (normalized across
  providers; `offset=0` is the newest page). New sessions:
  `POST /api/providers/sessions {provider, projectPath}`, then the first
  `chat.send` starts the agent. Rename uses
  `PUT /api/providers/sessions/:id {summary}`; the host trims the title, rejects
  empty values, and caps it at 500 characters.
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

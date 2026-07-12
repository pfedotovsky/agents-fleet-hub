# Agents Hub — Architecture

Last verified: 2026-07-11 (CloudCLI 1.36.1).

## Overview

Agents Hub is a **static React SPA with no backend**. The browser talks
directly to each configured CloudCLI host:

- REST (`/api/...`) with a Bearer JWT — projects, sessions, transcripts,
  files, models.
- One WebSocket per open chat (`/ws?token=JWT`) — live agent streaming,
  permission prompts, abort.

CloudCLI's CORS is wide open, which is what makes the no-backend design work.
All state that must survive a reload lives in the browser's localStorage.

```
Browser (Agents Hub SPA)
  ├─ REST poll every 12 s ──► host A  (remote VM, CloudCLI :3001)
  ├─ REST poll every 12 s ──► host B  (localhost:3001)
  └─ /ws?token=JWT ────────► whichever host owns the open chat
```

## Module map (`fleet-hub/src`)

| Module | Role |
| --- | --- |
| `App.tsx` | View router: a `View` union (`feed` / `project` / `files` / `chat`) in component state. No URL routing. |
| `hooks/useFleet.ts` | The heart of the app: host configs + prefs from storage, 12 s polling loop per host, host status machine, merged cross-host session feed, star toggle, login. |
| `lib/api.ts` | All REST calls. `fetchJson` adds timeout (AbortController), Bearer header, captures `X-Refreshed-Token`, maps 401/403 → `AuthError`, network failure → `HostUnreachableError`. |
| `lib/chatSocket.ts` | `ChatSocket` class — one reconnecting WS per chat (fixed 3 s retry until `close()`), typed senders: `chat.send` / `chat.subscribe` / `chat.abort` / `chat.permission-response` (with optional `rememberEntry`). |
| `lib/storage.ts` | localStorage wrapper, keys `fleethub.v1.{hosts,tokens,prefs,recentProjects,models,permissions,permissionModes,planMode,sidebarWidth,drafts,chatPanel}`. "Always allow" grants are keyed `hostId:projectPath`, permission mode per hostId, unsent chat drafts `hostId:sessionId`. |
| `lib/format.ts` | Relative-time and path helpers. |
| `types.ts` | Shared types: `HostConfig/HostRuntime/HostStatus`, `Project`, `SessionSummary`, `FleetSession`, `ChatEvent`, `PermissionMode`, model catalog. |
| `components/Sidebar.tsx` | Hosts → projects → chats tree: starred first, then recency; long tails behind "N more"; per-project disclosure lists recent sessions inline (embedded poll data, capped at 6; "all N chats…" opens the project pane); the active chat's project auto-expands; status dots. Hover "+" per project row creates a `claude` session and opens the chat directly (handler in `App.tsx`; errors → toast). |
| `components/SessionList.tsx` + `SessionRow.tsx` | "All sessions" merged feed rows. |
| `components/ProjectPane.tsx` | One project: paged session list, "New session" (provider picker), Files button. |
| `components/ChatPane.tsx` | Largest component: history paging over REST + live WS chat, permission prompts (allow / always-allow / deny), model/effort picker, persisted permission mode, persisted unsent draft per session, abort, `chat.subscribe` seq replay on reconnect, composer autocomplete dropdown (`CompletionMenu`), plan-mode toggle (Shift+Tab, persisted per host), header toggles that dock `FileBrowser`/`GitPanel` as a resizable right-hand panel (state in `App.tsx`, persisted in `chatPanel`). |
| `components/PlanPanel.tsx` | Docked right-hand drawer for a finished plan (ExitPlanMode request): decision buttons in the header, plan markdown below; a chip in the transcript reopens it. |
| `hooks/useComposerAutocomplete.ts` | `@`-file and `/`-command completion state for the chat composer: trigger detection at the caret, lazy per-target catalogs (file tree / skills+commands), filtering, keyboard navigation. |
| `components/Messages.tsx`, `Markdown.tsx`, `ToolCall.tsx`, `Diff.tsx` | Transcript rendering: GFM markdown w/ syntax highlighting; per-tool renderers (Edit/Write = LCS diff, Bash = terminal line, TodoWrite = checklist, Read/Grep/Glob = one-liners). |
| `components/FileBrowser.tsx`, `FileTree.tsx`, `CodeEditor.tsx` | Project file tree + lazy-loaded CodeMirror editor (One Dark); Cmd+S saves via `PUT /file`. Also renders `embedded` as a chat side panel (close icon, narrower tree). |
| `components/GitPanel.tsx` | Git status/stage/commit (AI message generation), branch switch/create, fetch/pull/push/publish, per-file diff. Full-screen via the project pane or `embedded` as a chat side panel. |
| `components/LoginModal.tsx`, `SettingsPanel.tsx`, `OfflineCard.tsx` | Per-host login and first-time setup (register; password never stored), host/prefs management, hibernated-VM card with restart hint. |

## Data flow

### Polling (`useFleet`)

- Every host is polled every **12 s** (`POLL_INTERVAL_MS`), staggered 300 ms
  at startup, plus on window focus and manual refresh.
- With a token: `GET /api/projects?sessionsLimit=5` → status `online` +
  projects. `AuthError` → drop token, `needs-auth`. Unreachable → `offline`.
- Without a token: `GET /api/auth/status` → `needs-setup` or `needs-auth`.
- In-flight guard per host: hibernating remote VMs eat the full fetch timeout,
  so polls must not stack.
- When a host goes offline its last-known projects are kept so sessions stay
  visible, dimmed as stale.
- The feed = flatten all hosts' `projects[].sessions[]`, sort by
  `lastActivity` desc, cap at 120, optional `hideCursor` filter. Recency of a
  *project* is derived client-side from `sessions[0].lastActivity` — the API
  returns projects unordered.

### Chat (`ChatPane` + `ChatSocket`)

- History: `GET /api/providers/sessions/:id/messages?limit&offset` —
  `offset=0` is the **newest** page; offsets walk backward and count raw
  messages including `tool_result` kinds.
- Live: `chat.send {sessionId, content, options{permissionMode, model, effort,
  toolsSettings{allowedTools, disallowedTools, skipPermissions}}}`;
  the server streams the same normalized message kinds as history plus
  `complete{success}`, `permission_request{requestId,toolName,input}`,
  `chat_subscribed{isProcessing,pendingPermissions}`, `session_upserted`,
  `protocol_error{code}`.
- Permissions: the server rebuilds SDK options from `chat.send` options on
  **every message** — nothing is stored per session — so the hub persists the
  permission mode and "always allow" grants per host+project and re-sends the
  grants as `toolsSettings.allowedTools` each send. Approving with
  `chat.permission-response {requestId, allow, rememberEntry}` additionally
  covers the rest of the in-flight run server-side. `rememberEntry` accepts
  only two shapes: a bare tool name (`Edit`) or a Bash prefix rule
  (`Bash(git:*)`). The SDK on the host loads the VM's own `.claude/settings*`
  (`settingSources: ['project','user','local']`), so `permission_request`
  frames only appear for tools not already allowed there. "Always allow"
  grants for claude sessions are also written through to the project's
  `.claude/settings.local.json` (`permissions.allow`) via the file API —
  best-effort: unparseable files are never overwritten, and PUT cannot create
  the `.claude/` directory, so a missing directory degrades to hub-only grants.
- CloudCLI runs Claude via `@anthropic-ai/claude-agent-sdk` `query()`
  in-process; the SDK in turn spawns the regular Claude Code executable
  (`pathToClaudeCodeExecutable`) using the VM's own `claude` login — same
  binary and auth as a terminal session, driven programmatically.
- Reconnect: on every WS open the owner re-subscribes with
  `chat.subscribe {sessions:[{sessionId,lastSeq}]}` — the server replays
  missed events by sequence number.
- New session: `POST /api/providers/sessions {provider, projectPath}` creates
  an empty app session; the first `chat.send` actually starts the agent.
- Model catalog: `GET /api/providers/:provider/models` →
  `{OPTIONS:[{value,label,effort?}], DEFAULT}`; the chosen model+effort is
  stored per host and sent in `chat.send` options.
- Composer autocomplete (`useComposerAutocomplete`): typing `@` (after
  whitespace/start) completes project files from `GET /api/projects/:id/files`
  flattened to project-relative paths; typing `/` **at the start of the
  message** completes skills and custom commands. Skills come from
  `GET /api/providers/:provider/skills?workspacePath=<abs>` →
  `{success, data:{skills:[{name, description, command, scope, sourcePath}]}}`
  (SKILL.md files, project + user scope; verified live on 1.36.1); custom
  commands from `POST /api/commands/list {projectPath}` → `{builtIn, custom}`
  (`.claude/commands/*.md`, project + user). The response's `builtIn` entries
  (/help, /models, /cost, …) are CloudCLI-frontend features, not agent
  commands, so the hub drops them. Selecting inserts `@path ` / `/name ` into
  the input and the message is sent as **plain chat text** — the Claude Code
  binary spawned by the SDK expands slash commands, skills, and `@`-mentions
  itself (same reason CloudCLI's own UI sends picked skills as plain input).
  Both catalogs are fetched lazily on first trigger and cached until the chat
  target changes.

### Auth

- Login: `POST /api/auth/login {username,password}` → JWT. Only the JWT is
  stored (localStorage, per host); passwords never leave component state.
- First-time setup: CloudCLI is single-user; while a host has no account,
  `GET /api/auth/status` reports `needsSetup` and the login modal switches to
  create-account mode → `POST /api/auth/register {username,password}` → JWT
  (allowed only while no user exists; server rules: username ≥ 3, password ≥ 6).
- Sliding refresh: any authenticated response may carry `X-Refreshed-Token`;
  `fetchJson` always captures it via a callback.
- **Both 401 and 403 mean auth failure** (CloudCLI returns 403 for a *bad*
  JWT, 401 for a missing one).

## Verified CloudCLI 1.36.1 quirks

Non-obvious facts this code depends on (verified from source + live). Server
*defects* (as opposed to quirks) are cataloged separately in
[cloudcli-server-issues.md](cloudcli-server-issues.md), which also tracks the
fork-vs-workaround considerations.

- `GET /api/projects` returns a **bare array** (no envelope) and triggers a
  disk→DB session sync server-side — it can be slow.
- Session `messageCount` is hardcoded to 0 — never display it.
- Projects arrive unordered; sessions within a project are newest-first.
- Cursor-IDE-created sessions have no store.db → transcripts and deep links
  fail for them (hence the warning badge + hide toggle).
- File API: `GET .../files` = bare array tree, absolute paths,
  node_modules/.git pruned, depth 10; relative paths in `PUT .../file`
  resolve against the project root.
- Deep links into a host's own UI require having signed into that host's page
  once — its frontend keeps its JWT in *its own origin's* localStorage
  (`auth-token`) with no URL-token handoff, so the hub cannot authenticate it.
- Some VMs are IPv6-only: CloudCLI must then be launched with `HOST=:: cloudcli`.
- **Sessions can be permanently "lost" by a U+2028 in a message**
  ([siteboon/claudecodeui#1002](https://github.com/siteboon/claudecodeui/issues/1002),
  reported by us 2026-07-11): CloudCLI's indexer reads transcript JSONL with
  Node `readline`, which splits lines on U+2028/U+2029, so one such character
  (common in pasted text) makes the whole file unparseable to it; incremental
  scans filter by file *birthtime*, so the file is never retried. The session
  then shows as "Untitled" with an empty transcript, though the JSONL on disk
  is intact. Recovery: escape raw `E2 80 A8` bytes to `\u2028` in the JSONL,
  rewind `scan_state.last_scanned_at` in `~/.cloudcli/auth.db` to before the
  file's creation time, then hit `GET /api/projects` to re-index.

## Security model

A host's JWT allows running arbitrary code as the user on that machine.
Tokens live only in the browser's localStorage of wherever the hub page is
served from — **do not host this page anywhere public**. `chat.permission-response`
approvals are real permission grants on the remote agent.

## Build / tooling

Vite 8 + `@vitejs/plugin-react`, TypeScript 6 (`tsc -b` runs as part of
`npm run build` and is the typecheck), Tailwind CSS v4 via `@tailwindcss/vite`,
oxlint for linting. No test framework is set up.

## Desktop packaging (Tauri)

`fleet-hub/src-tauri/` wraps the built SPA in a Tauri 2 shell ("Agents Hub",
`io.github.pfedotovsky.agents-hub`). It's packaging only: the stock Rust entry
point with no custom commands, no Tauri plugins, and the default capability
set — the webview loads `dist/` and the frontend code is byte-identical to the
browser build, still calling CloudCLI hosts directly (their open CORS covers
the `tauri://` origin). `npm run tauri dev` (requires Rust via rustup) /
`npm run tauri build`.

Releases: pushing a `v*` tag runs `.github/workflows/release.yml`
(tauri-action) → universal macOS `.dmg` + Linux AppImage/deb/rpm on the GitHub
Release. macOS signing/notarization is wired but dormant until `APPLE_*` repo
secrets exist (the workflow exports them only when non-empty — an empty-string
`APPLE_CERTIFICATE` would make Tauri attempt signing and fail). macOS installs
go through the `agents-hub` cask in `pfedotovsky/homebrew-tap`; a version bump
there means updating `version` + `sha256`. The app version lives in
`src-tauri/tauri.conf.json` (+ `Cargo.toml`, `package.json`).

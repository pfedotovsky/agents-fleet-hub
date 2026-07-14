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
| `lib/storage.ts` | localStorage wrapper, keys `fleethub.v1.{hosts,tokens,prefs,recentProjects,models,permissions,permissionModes,planMode,sidebarWidth,drafts,chatPanel,autoAdded}`. "Always allow" grants are keyed `hostId:projectPath`, permission mode per hostId, unsent chat drafts `hostId:sessionId`. |
| `lib/format.ts` | Relative-time and path helpers. |
| `types.ts` | Shared types: `HostConfig/HostRuntime/HostStatus`, `Project`, `SessionSummary`, `FleetSession`, `ChatEvent`, `PermissionMode`, model catalog. |
| `components/Sidebar.tsx` | Hosts → projects → chats tree: starred first, then recency; long tails behind "N more"; per-project disclosure lists recent sessions inline (embedded poll data, capped at 6; "all N chats…" opens the project pane), each chat prefixed with its provider icon (Claude/Codex/…) from `PROVIDER_META`; the active chat's project auto-expands; status dots. Hover "+" per project row opens a **draft** chat directly (handler in `App.tsx`) — the session is created on first send with the provider chosen in the composer toggle (seeded from the last-picked provider). |
| `components/SessionList.tsx` + `SessionRow.tsx` | "All sessions" merged feed rows. |
| `components/ProjectPane.tsx` | One project: paged session list, "New session" (opens a draft chat — provider is chosen in the composer, not here), Files button. |
| `components/ChatPane.tsx` | Largest component: history paging over REST + live WS chat, permission prompts (allow / always-allow / deny), model/effort picker, persisted permission mode, persisted unsent draft per session, abort, `chat.subscribe` seq replay on reconnect, composer autocomplete dropdown (`CompletionMenu`), plan-mode toggle (Shift+Tab, persisted per host), header toggles that dock `FileBrowser`/`GitPanel` as a resizable right-hand panel (state in `App.tsx`, persisted in `chatPanel`). Holds `sessionId`/`provider` as state so a **draft** (empty id) can defer session creation to the first send: the composer shows a Claude/Codex toggle, then `createSession` runs and the message is flushed once the new session's socket re-subscribes. A provider-labelled context-window chip renders per-turn `token_budget` usage (bounded by the window). |
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
- Without a token: `GET /api/auth/status` → if it reports `localAuthBypass`
  (same-machine fleet-server), mint a token via `POST /api/auth/local-token`
  and poll as online; otherwise `needs-setup` or `needs-auth`.
- On launch, `useFleet` runs discovery once and auto-adds a local
  **fleet-server** (port 3011) as a host — CloudCLI (3001) stays a manual
  suggestion in Settings. Auto-added URLs are remembered
  (`fleethub.v1.autoAdded`) so removing the host sticks.
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
  **every message**, so the hub persists the permission mode and "always
  allow" grants per host+project and re-sends the grants as
  `toolsSettings.allowedTools` each send. The server *does* persist the last
  `permissionMode` and falls back to it when a `chat.send` omits one, so the
  hub always sends an explicit mode (never omits `'default'`) — otherwise a
  prior plan-mode send would silently re-apply and Codex, which has no
  `ExitPlanMode` reset, would stay stuck read-only. Approving with
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
- Multi-client caveats (verified against 1.36.1 server source): the server
  emits **no frame** when a pending permission is resolved by another client —
  `permission_cancelled` fires only on timeout/abort — and each run's live
  stream is routed to **one** socket (`attachConnection` reroutes the writer to
  the latest subscriber, stealing the stream — including `complete`). The hub
  therefore treats `chat_subscribed.pendingPermissions` as the authoritative
  full pending set (state is replaced, never merged) and re-sends
  `chat.subscribe` on the 15 s fallback poll, which both reconciles the cards
  and re-attaches the stream. Permission responses are checked for delivery:
  a send on a closed socket keeps the card and shows a banner instead of
  silently dropping the answer (interactive requests wait server-side forever).
- Image attachments on user messages come in two shapes: hub-sent ones are
  stored-asset paths (`{path, name}`, fetched with auth via `AuthedImage`);
  messages sent from CloudCLI's own UI inline the image as
  `{data: 'data:image/…;base64,…'}` with no path, rendered as a plain `<img>`.
- CloudCLI runs Claude via `@anthropic-ai/claude-agent-sdk` `query()`
  in-process; the SDK in turn spawns the regular Claude Code executable
  (`pathToClaudeCodeExecutable`) using the VM's own `claude` login — same
  binary and auth as a terminal session, driven programmatically.
- Reconnect: on every WS open the owner re-subscribes with
  `chat.subscribe {sessions:[{sessionId,lastSeq}]}` — the server replays
  missed events by sequence number. The hub also resubscribes every 15 s
  while the tab is visible (piggybacked on the fallback poll) to reconcile
  pending permissions and reclaim the live stream from other clients.
  Replay caveat: a mid-run subscribe with `lastSeq: 0` (every ChatPane mount)
  replays the run's whole event log **including already-resolved
  `permission_request` frames**. The `chat_subscribed` ack precedes the
  replay and carries the run's current `lastSeq`; ChatPane keeps it in
  `ackedRunSeq` and drops `permission_request` frames at `seq <=` that mark
  (still-pending ones arrive via the ack's `pendingPermissions`). Seqs
  restart at 0 per run, so the mark resets on complete/send/mount/idle acks.
- New session: `POST /api/providers/sessions {provider, projectPath}` creates
  an empty app session; the first `chat.send` actually starts the agent.
- **Codex sessions** run server-side via `@openai/codex-sdk` threads and
  differ from claude in ways the hub accounts for: no interactive approvals
  (`permission_request` never fires; `permissionMode` is remapped to a
  sandbox — default→workspace-write+ask-untrusted, acceptEdits→never-ask,
  bypass→danger-full-access, and the plan toggle→`read-only` with a
  planning preamble prepended to the prompt). The mode select is relabeled.
  Plan mode is supported, but since Codex emits no `ExitPlanMode` request to
  drive `PlanPanel`, a completed plan-mode run shows a lightweight "plan
  ready" Build card in the transcript instead (Build leaves plan mode and
  sends a go-ahead so the same thread resumes writable). `toolsSettings`
  is ignored (not sent), live `tool_use` frames carry results inline
  (`output`/`exitCode`, no `tool_result` frame; repeated ids are upserted in
  place by `appendMessage`), history serializes `toolInput` as a JSON string
  and `toolResult.content` sometimes as `{type,text}[]` parts, history shell
  tools are named `exec_command`/`exec`/`write_stdin`, skills are
  `$`-prefixed, and a turn-end `status {text:'token_budget'}` frame feeds the
  header usage chip. Empty codex chats preflight
  `GET /api/providers/codex/auth/status` into a banner.
- Model catalog: `GET /api/providers/:provider/models` →
  `{OPTIONS:[{value,label,effort?}], DEFAULT}`; the chosen model+effort is
  stored per `hostId:provider` (legacy bare-hostId entries still read for
  claude) and sent in `chat.send` options. `fleethub.v1.lastProvider` (per
  host) seeds the project pane's provider picker and the sidebar
  quick-create "+".
- Composer autocomplete (`useComposerAutocomplete`): typing `@` (after
  whitespace/start) completes project files from `GET /api/projects/:id/files`
  flattened to project-relative paths; typing `/` (claude) or `$` (codex
  skills) **at the start of the message** completes skills and custom
  commands — the menu only shows entries matching the typed prefix, and the
  `.claude/commands` catalog is fetched for claude sessions only. Skills come
  from
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
- Host-side setup (fleet-server): `fleet-server auth setup` initializes the
  local SQLite database and creates or upgrades the single account without
  going through HTTP. The installer does not prompt for credentials;
  automation can pipe one password line with `--password-stdin`.
- Passwordless localhost (fleet-server only, `[fork-fix #16]`): when
  `GET /api/auth/status` reports `localAuthBypass` (server checks the TCP
  peer address is loopback; opt out with `FLEET_LOCALHOST_NO_AUTH=false`),
  the hub mints a normal JWT via `POST /api/auth/local-token` — no login
  modal. The server auto-provisions a `local` user with a sentinel (non-
  bcrypt) hash; `fleet-server auth setup` can later upgrade it to a real
  username+password for remote access, and `login` rejects sentinel accounts
  with 401. While no real password account exists, `GET /api/auth/status`
  reports `needsSetup: false` plus `needsCliAuthSetup: true`, so no hub setup
  UI is shown.
- First-time setup (stock CloudCLI only): CloudCLI is single-user; while a
  host has no account, `GET /api/auth/status` reports `needsSetup` and the
  login modal switches to create-account mode →
  `POST /api/auth/register {username,password}` → JWT (server rules: username
  ≥ 3, password ≥ 6). fleet-server keeps the endpoint for API compatibility
  but returns 410 instructing users to run `fleet-server auth setup` on the
  host.
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
- Some VMs expose only IPv6 through their public hostname. CloudCLI must then
  be launched with `HOST=:: cloudcli`; fleet-server defaults to `HOST=::` and
  falls back to `0.0.0.0` only when the OS cannot bind IPv6.
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

## Native Codex app visibility of Agents Hub sessions

**Symptom:** Codex sessions created from Agents Hub do not appear in the native
ChatGPT/Codex desktop app's Recent tasks/task search, even on the same machine
and in the same project folder.

**Root cause — different Codex client surface.** Agents Hub talks to
fleet-server, and fleet-server drives Codex through `@openai/codex-sdk`
(`openai-codex.js`: `Codex.startThread()` / `resumeThread()`). The resulting
provider-native thread writes normal Codex rollout JSONL under
`~/.codex/sessions/**`, which fleet-server indexes directly with
`codex-session-synchronizer.provider.ts`. The desktop app, however, is a rich
client backed by Codex app-server task/thread APIs and its own local task list;
there is no API call in the hub or fleet-server that registers SDK-created
threads into that desktop app task index. So the visibility is one-directional:
Agents Hub can see Codex CLI/SDK transcripts on disk, but the desktop app does
not discover Agents Hub's app-created rows as app tasks.

**Ids are also intentionally remapped.** The hub allocates a stable
app-facing `session_id` before the first send (`POST /api/providers/sessions`).
Codex later announces its provider-native thread id, and fleet-server stores it
as `provider_session_id`. The browser sees only the app-facing id; Codex
CLI/app surfaces need the provider-native id if resuming outside the hub.

**Potential bridge.** The official Codex app-server is the supported rich-client
integration surface for authentication, conversation history, approvals, and
streamed events. Making Agents Hub sessions show up as native desktop tasks
would require either driving Codex through app-server from the start or adding a
deliberate import/register bridge; scanning `~/.codex/sessions` is enough for
Agents Hub, but not for the native app's task list.

## Claude Code `--resume` visibility of Agent Hub sessions

**Symptom:** sessions created through Agent Hub do not appear in the interactive
`claude --resume` / `/resume` picker, even when run from the same project
directory. Only sessions started by the interactive terminal show up.

**Root cause — `CLAUDE_CODE_ENTRYPOINT`.** fleet-server runs Claude via the
Agent SDK (`@anthropic-ai/claude-agent-sdk`, see `claude-sdk.js`), not the
interactive CLI. The SDK stamps the spawned process with
`CLAUDE_CODE_ENTRYPOINT=sdk-ts`, and every transcript entry it writes records
`"entrypoint":"sdk-ts"`. The Claude Code CLI's resume picker deliberately
filters these out: it keeps a set `{"sdk-cli","sdk-ts","sdk-py"}` and drops any
session whose `entrypoint` is in it (unless the picker itself was launched from
an SDK context), logging `Session <id> filtered from /resume:
entrypoint=sdk-ts`. Verified in the `claude` 2.1.207 binary. Interactive
sessions record `entrypoint:"cli"` and are shown.

**What still works.** This is *only* a picker-visibility filter, not a storage
difference. SDK sessions are written to the standard
`~/.claude/projects/<encoded-cwd>/<id>.jsonl` with matching `cwd`, and are fully
resumable **by explicit id**, which bypasses the picker:
`claude --resume <session-id>`. The Hub itself lists them because it scans
`~/.claude/projects/**` on disk directly (`sessions-watcher.service.ts`,
`claude-session-synchronizer.provider.ts`) rather than going through the CLI
picker — which is why the visibility is one-directional (Hub sees terminal
sessions; the terminal picker does not see Hub sessions).

**Making Hub sessions appear natively (optional).** The SDK sets the entrypoint
only when unset (`sdk.mjs`: `if (!ft.CLAUDE_CODE_ENTRYPOINT)
ft.CLAUDE_CODE_ENTRYPOINT = "sdk-ts"`), and fleet-server forwards its whole env
to the SDK (`claude-sdk.js`: `sdkOptions.env = { ...process.env }`). So exporting
`CLAUDE_CODE_ENTRYPOINT=cli` for the fleet-server process — e.g. a line in
`~/.fleet-server/.env` — makes new sessions record `entrypoint:"cli"` and show
in the picker. Existing transcripts can be back-filled by rewriting
`"entrypoint":"sdk-ts"` → `"entrypoint":"cli"` in the `.jsonl` files. **Caveat:**
`entrypoint` is how Anthropic classifies interactive vs Agent-SDK usage, and the
CLI also branches on it for telemetry and rate-limit bucketing — forcing `cli`
reports SDK traffic as interactive, so treat this as a deliberate, documented
choice, not a default.

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

## Web UI distribution (`/fleet-hub`)

A second, no-code-signing distribution channel: fleet-server serves the same
`fleet-hub` build at `http://<host>:3011/fleet-hub/`. It is deliberately kept
separate from the API — the API stays under `/api`, the `/` landing page is
unchanged, and the UI lives only under `/fleet-hub`.

- **One build, two shells.** `fleet-hub` builds with Vite `base: './'` so asset
  URLs are relative; the identical `dist/` works both in the Tauri webview
  (loaded from `tauri://localhost/`) and under the `/fleet-hub/` sub-path. Bare
  `/fleet-hub` 308-redirects to `/fleet-hub/` so relative URLs resolve under the
  sub-path.
- **Embedded, not on disk.** `fleet-server/scripts/generate-hub-assets.ts` copies
  `fleet-hub/dist` → `server/hub-dist/` and emits `server/hub-assets.generated.js`
  (one `import … with { type: 'file' }` per asset). `bun build --compile` embeds
  those bytes into the single binary; `server/hub-assets.js` (`mountHub`) reads
  them via `Bun.file()`. Both outputs are gitignored and regenerated by
  `scripts/build.ts` before every compile. Running from source (`bun run`) with
  an empty/absent manifest falls back to reading `fleet-hub/dist` off disk.
- **Route ordering.** `mountHub` must register at module-eval time, before the
  `app.get('*')` catch-all in `server/index.js`, or the catch-all 404s the
  sub-path. Hashed `assets/*` are served `immutable`; `index.html` is `no-cache`.
- **Mixed-content caveat.** A browser tab served over HTTPS cannot call a plain
  `http://` fleet-server (mixed content), so this channel is intended for the
  host serving its own UI over HTTP on the LAN.

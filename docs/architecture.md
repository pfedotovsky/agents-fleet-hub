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

Browser regression coverage uses a deterministic, sanitized fake host under
`fleet-hub/tests/ux/`. It implements only the REST/WebSocket states required by
the Playwright journeys, so CI exercises source Hub behavior without a real
host, credentials, or transcript data. The fixture covers opening and reloading
persisted history plus creating a session, sending its first prompt, receiving a
live response, approving and denying tool requests, restoring a pending request
after reload, answering a structured user question, reconciling against canonical
history, reloading that created session, and streaming a sanitized
conversation-search result that opens and reloads its canonical transcript. It
also persists a reversible session archive across reload, restores the session
from the lazy archive list, and verifies the unchanged transcript after restore.
An interrupted run emits one aborted terminal frame, accepts a follow-up resume
turn, drops the synthetic socket mid-run, and replays the missed completion from
the last acknowledged sequence before canonical history and reload are checked.
Shared page setup also makes console, page, and HTTP failures fatal
across transcript, keyboard/focus, accessible-name, contrast, reduced-motion,
narrow-width, and targeted visual checks. See `docs/ux-regression-testing.md`.

```
Browser (Agents Hub SPA)
  ├─ REST poll every 12 s ──► host A  (remote VM, CloudCLI :3001)
  ├─ REST poll every 12 s ──► host B  (localhost:3001)
  └─ /ws?token=JWT ────────► whichever host owns the open chat
```

## Module map (`fleet-hub/src`)

| Module | Role |
| --- | --- |
| `App.tsx` | View router: a `View` union (`feed` / `project` / `files` / `chat`) in component state. Only the open `chat` view syncs to the URL — mirrored into `location.hash` and hydrated back from an incoming hash once the host loads (see `lib/deepLink.ts`); all other navigation stays in-memory. Deep links first reuse discovery metadata, then fall back to exact-id `GET /api/providers/sessions/:sessionId` so a known child transcript can open without adding hidden child rows to any list. The feed's global New session action opens a stable-key, initially unbound chat draft and supplies `ChatPane` with project targets derived from online `useFleet` runtimes. Selecting one replaces the draft's host/project fields without remounting it. |
| `lib/deepLink.ts` | Shareable session links. Serializes an open chat to `#/s/<hostId>/<projectId>/<sessionId>` and back, and builds an absolute URL against `document.baseURI` so it resolves under `/fleet-hub/`, `/` (dev), and Tauri. Hash-only (no server routing); carries host+project because a session id is unique only per host and is resolved from the loaded projects list. |
| `hooks/useFleet.ts` | The heart of the app: host configs + prefs from storage, 12 s polling loop per host, host status machine, merged cross-host session feed, project creation/clone/rename/archive/restore, star toggle, session rename, login. Successful project creates, clones, renames, and archives plus session renames patch the loaded host state without waiting for the next poll; restores trigger reconciliation. |
| `lib/api.ts` | All REST calls. `fetchJson` adds timeout (AbortController), Bearer header, captures `X-Refreshed-Token`, maps 401/403 → `AuthError`, network failure → `HostUnreachableError`, and normalizes both legacy string errors and fleet-server's structured `{error:{message,details}}` responses into readable exceptions. |
| `lib/chatSocket.ts` | `ChatSocket` class — one reconnecting WS per chat (fixed 3 s retry until `close()`), typed senders: `chat.send` / `chat.subscribe` / `chat.abort` / `chat.permission-response` (with optional `rememberEntry`). |
| `lib/storage.ts` | localStorage wrapper, keys `fleethub.v1.{hosts,tokens,prefs,recentProjects,models,permissions,permissionModes,planMode,sidebarWidth,drafts,chatPanel,autoAdded}`. "Always allow" grants are keyed `hostId:projectPath`, permission mode per hostId, unsent chat drafts `hostId:sessionId`; `prefs.defaultSessionView` persists `structured`/`terminal`. A legacy docked `chatPanel.kind === 'terminal'` is normalized to closed. |
| `lib/format.ts` | Relative-time and path helpers. |
| `lib/motion.ts` | Shared `motion` (Framer Motion) variants/transitions (message reveal, card enter/exit, overlay backdrop/modal/panel, list-row layout spring). Enters ~200-240ms ease-out, exits shorter ease-in. Reduced-motion is global via `<MotionConfig reducedMotion="user">` in `main.tsx`. Consumed by `Messages`, `ChatPane` (permission/plan cards in `AnimatePresence`), `SessionRow`/`SessionList` (`layout` reflow), and the overlays (`SettingsPanel`/`SearchOverlay`/`LoginModal`, wrapped in `AnimatePresence` in `App.tsx`). |
| `lib/theme.ts` + `hooks/useTheme.ts` | Theme system. `index.css` holds a two-layer Tailwind v4 token set: one neutral-grayscale primitive ramp (`--color-ink-*`) and semantic tokens (`--color-canvas/surface/elevated/line/fg/accent/on-accent/…`) — components use **only** the semantic classes (`bg-surface`, `text-fg-muted`, `border-line`, …); no raw `ink-*` classes remain. It's a Codex-style **monochrome** system: there is no brand-color accent — the `accent` role is a high-contrast neutral (near-white primary on dark, near-black on light) that inverts for free because it points at the ramp ends. Color is limited to the functional status tokens and the host/provider identity marks (`lib/format.ts`, `Messages.tsx`). One type family (`--font-display` aliases `--font-sans`). `[data-theme="light"]` on `<html>` defines light by remapping the primitive ramp (plus color-scheme + status colors). Choice (`system`/`dark`/`light`) is persisted at `fleethub.v1.theme` and resolved before paint by an inline FOUC-guard script in `index.html`. `useResolvedTheme()` exposes the concrete dark/light value via a `data-theme` MutationObserver for the two spots that can't use a token — the Prism highlighter in `Markdown.tsx` (`oneLight`/`oneDark`) and the CodeMirror editor in `CodeEditor.tsx`. |
| `types.ts` | Shared types: `HostConfig/HostRuntime/HostStatus`, `Project`, `SessionSummary`, `FleetSession`, `ChatEvent`, `PermissionMode`, model catalog. |
| `components/Sidebar.tsx` | Hosts → projects → chats tree: starred first, then recency; long tails behind "N more"; per-project disclosure lists recent sessions inline (embedded poll data, capped at 6; "all N chats…" opens the project pane), each chat prefixed with its provider icon (Claude/Codex/…) from `PROVIDER_META`; the active chat's project auto-expands; status dots. Online project and session rows expose their inline rename forms. Hover "+" per project row opens a **draft** chat directly (handler in `App.tsx`) — the session is created on first send with the provider chosen in the composer toggle (seeded from the last-picked provider). Per-host archived projects and chats are fetched only when their separate archive sections expand. Archived projects can be restored or permanently deleted only after a server-authored impact preview and exact canonical-path confirmation; archived chats retain their separate restore/delete interaction. |
| `components/ProjectRenameForm.tsx` | Shared project-name editor used by the sidebar and project header. Enter saves, Escape cancels, host errors keep the editor open, and blank input asks the host to restore its default name. |
| `components/SessionList.tsx` + `SessionRow.tsx` + `SessionRenameForm.tsx` | "All sessions" merged feed rows and the shared inline rename interaction. Save awaits the host mutation; errors keep the editor open, Escape cancels, and stale/offline rows omit the action. `ProjectPane` reuses the row and additionally patches sessions loaded outside the fleet poll's initial page. |
| `components/ProjectPane.tsx` | One project: editable display name, paged session list, "New session" (opens a draft chat — provider is chosen in the composer, not here), Files/Git buttons, and an inline-confirmed soft Archive action that never deletes files or transcripts. |
| `components/ChatPane.tsx` | Largest component: history paging over REST + live WS chat, permission prompts (allow / always-allow / deny), model/effort picker (`ModelSelect`, a custom dropdown that lists each model with its description inline), persisted permission mode, persisted unsent draft per session, abort, `chat.subscribe` seq replay on reconnect, composer autocomplete dropdown (`CompletionMenu`), plan-mode toggle (Shift+Tab, persisted per host), header toggles that dock `FileBrowser`/`GitPanel` as a resizable right-hand panel (state in `App.tsx`, persisted in `chatPanel`) and switch the primary session surface to Terminal. Holds `sessionId`/`provider` as state so a **draft** (empty id) can defer session creation to the first send: the composer shows a Claude/Codex toggle, then `createSession` runs and the message is flushed once the new session's socket re-subscribes. A top-level draft may also start without host/project fields: it opens no socket and disables message controls until its composer binds an online project, creates/registers a host path, or clones a repository through the authenticated SSE progress route; the normal first-send path then takes over. A provider-labelled context-window chip loads persisted usage through `GET /api/projects/:projectId/sessions/:sessionId/token-usage` on open; a later live `token_budget` frame supersedes it. The REST request is best-effort so stock/older hosts still load the transcript. |
| `components/ProviderReadinessBanner.tsx` | First-message recovery for Claude/Codex hosts. Renders the structured missing-CLI vs signed-out state, the exact provider-owned install/login command, copy feedback, and an explicit retry without installing a provider or collecting credentials in the Hub. |
| `components/PlanPanel.tsx` | Docked right-hand drawer for a finished plan (ExitPlanMode request): decision buttons in the header, plan markdown below; a chip in the transcript reopens it. |
| `hooks/useComposerAutocomplete.ts` | `@`-file and `/`-command completion state for the chat composer: trigger detection at the caret, lazy per-target catalogs (file tree / skills+commands), filtering, keyboard navigation. |
| `components/Messages.tsx`, `Markdown.tsx`, `ToolCall.tsx`, `Diff.tsx` | Transcript rendering: GFM markdown w/ syntax highlighting; per-tool renderers (Edit/Write = LCS diff, FileChanges = per-file unified diffs, Bash = terminal line, TodoWrite = checklist, Read/Grep/Glob = one-liners). |
| `components/FileBrowser.tsx`, `FileTree.tsx`, `CodeEditor.tsx` | Project file tree + lazy-loaded CodeMirror editor (One Dark); Cmd+S saves via `PUT /file`. The Explorer upload button sends multiple files to the project root, while dropping onto a folder targets that folder; conflicts require explicit replacement and upload progress/errors stay inline. Also renders `embedded` as a chat side panel (close icon, narrower tree). |
| `components/GitPanel.tsx` + `GitHistory.tsx` | Changes/History Git workspace. Changes covers status/stage/commit (AI message generation), branch switch/create, fetch/pull/push/publish, and per-file diff. History lazily loads commits across branches/remotes/tags with bounded expansion and opens a selected commit's patch in the shared `Diff` viewer. Full-screen via the project pane or `embedded` as a chat side panel. |
| `lib/shellSocket.ts`, `components/TerminalPanel.tsx` | Reconnecting `/shell` PTY client + xterm full session view. Existing sessions resume their provider CLI by id; drafts start a new CLI in the project path. The PTY stays deliberately dark under both app themes. On unmount, queued xterm viewport animation frames drain before renderer disposal; immediate disposal races `Viewport.syncScrollArea()` against a missing renderer. |
| `components/LoginModal.tsx`, `SettingsPanel.tsx`, `OfflineCard.tsx` | Per-host login and first-time setup (register; password never stored), host/prefs management (incl. Appearance and default Structured/Terminal session view), hibernated-VM card with restart hint. |

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
  **fleet-server** as a host: Vite development builds discover the interpreted
  source server on port 3012 (data in `~/.fleet-server-dev`) and label it
  `localhost (dev)`; packaged builds discover the released server on port
  3011 (data in `~/.fleet-server`). CloudCLI (3001) stays a manual
  suggestion in Settings. An older Vite-local `localhost` entry for port 3011
  is relabeled `localhost (release)`. Auto-added URLs are remembered
  (`fleethub.v1.autoAdded`) so removing the host sticks.
- Root `npm run dev` orchestrates the source stack without another dependency:
  it starts fleet-server, waits for `http://localhost:3012/health`, then starts
  Vite on 5173; termination of either process shuts down the other.
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
  The deterministic browser fixture exercises allow and deny responses, restores
  a pending request from `chat_subscribed.pendingPermissions` after a full reload,
  and checks that an `AskUserQuestion` answer returns in `updatedInput` before the
  canonical transcript is reconciled.
- Image attachments on user messages come in two shapes: hub-sent ones are
  stored-asset paths (`{path, name}`, fetched with auth via `AuthedImage`);
  messages sent from CloudCLI's own UI inline the image as
  `{data: 'data:image/…;base64,…'}` with no path, rendered as a plain `<img>`.
- CloudCLI runs Claude via `@anthropic-ai/claude-agent-sdk` `query()`
  in-process; the SDK in turn spawns the regular Claude Code executable
  (`pathToClaudeCodeExecutable`) using the VM's own `claude` login — same
  binary and auth as a terminal session, driven programmatically. fleet-server
  keeps `CLAUDE_STARTUP_TIMEOUT_MS` (45 s default) armed past SDK init events
  until assistant output, a stream delta, or a terminal result arrives. If an
  unreachable API never produces one, it closes the query and emits an error +
  terminal completion; later long turns and interactive waits are unaffected.
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
  restart at 0 per run, so ChatPane clears both its replay watermark and
  permission mark before every send; otherwise a reconnect during a later run
  could skip events whose sequence is below the prior run's terminal sequence.
- New session: `POST /api/providers/sessions {provider, projectPath}` creates
  an empty app session; the first `chat.send` actually starts the agent.
- Arbitrary project folder: a global draft calls
  `POST /api/projects/create-project {path}` on its selected host. The server
  resolves and validates the path against `WORKSPACES_ROOT` (the user's home by
  default), creates the directory when missing, registers or unarchives its DB
  row, and returns the project. `useFleet` inserts that result immediately so
  the draft can bind it before the next 12-second poll. The browser never
  interprets a remote path as a local one.
- Repository clone: the same Add folder surface can call authenticated
  `GET /api/projects/clone-progress?path=<destination>&githubUrl=<source>`.
  `lib/api.ts` incrementally parses its SSE `progress`, `complete`, and `error`
  payloads because native `EventSource` cannot attach the host JWT. The latest
  host-reported line is shown live; aborting the fetch closes the request so
  fleet-server cancels Git and removes its partial target. A successful
  `complete` payload is the authoritative registered project and is inserted
  into fleet state before the draft binds to it. HTTPS and SSH clones rely on
  credentials already available to Git on that host; the browser never asks
  for or sends a repository token, and rejects credential-bearing HTTP(S)
  source URLs before starting the request.
- Project file upload: `FileBrowser` sends multipart `files` to
  `POST /api/projects/:projectId/files/upload`, using `XMLHttpRequest` rather
  than `fetch` so the Explorer can show byte upload progress. The attach button
  targets the project root; a drop on a folder sends that folder's absolute
  host path. The client checks the loaded tree for conflicts first and sends
  `overwrite=false` unless the user explicitly chooses Replace. fleet-server's
  `[fork-fix #20]` validates the complete batch before writing, preserves bytes,
  creates nested directories, enforces project-root containment, rejects
  traversal and symlink escapes, rejects conflicts with 409, enforces the
  20-file/200 MB limits, and always removes multipart temp files. Stock CloudCLI
  ignores the extra overwrite field and retains its existing route behavior,
  so the client-side conflict check remains the compatibility guard there.
- Project archive/restore/delete: the project pane calls
  `DELETE /api/projects/:projectId` without `force`, which only marks the host
  DB row archived and removes the project from active fleet state after
  success. Each online host lazily loads `GET /api/projects/archived`; restore
  calls `POST /api/projects/:projectId/restore` and re-polls active projects.
  Permanent deletion is available only inside that archived list. The Hub first
  loads `GET /api/projects/:projectId/deletion-preview`, which returns the
  canonical absolute path, session/file/byte impact, active operations, and Git
  dirty/untracked/unpushed risk. It enables
  `DELETE /api/projects/:projectId?force=true` only when the user types that
  canonical path exactly; the same path is sent in `confirmationPath` and is
  checked again by the server.
- Permanent project deletion holds an exclusive project-tree activity lease.
  Chat runs, persistent PTYs, clones, uploads, project registration/restore,
  and other project file routes register ordinary leases, so deletion is
  rejected while any overlap is active and new operations cannot start after
  the final check. The server
  rejects non-archived rows, filesystem/workspace roots, the user's home,
  fleet-server state (including descendants), database/runtime paths and their
  ancestors, targets that contain another registered project, non-canonical or
  symlink roots, and transcript paths outside known provider storage. Recursive
  filesystem APIs remove the workspace first (directory symlinks are unlinked,
  never followed),
  then distinct JSONL transcripts, then session and project rows in one SQLite
  transaction. A filesystem failure leaves the archived DB rows intact; a
  retry can finish cleanup even when the workspace was already removed.
- Project rename: `PUT /api/projects/:projectId/rename {displayName}` changes
  only the host DB display name; it never moves or renames the workspace path.
  fleet-server returns the authoritative resolved `displayName`. A blank value
  persists the folder basename rather than `null`, because `null` would let the
  project-list display-name generator overwrite the reset on its next poll.
  The hub patches the loaded project immediately; feed rows derive from that
  state, while `App.tsx` separately updates the frozen open-chat target.
- Session rename: `PUT /api/providers/sessions/:sessionId {summary}` stores a trimmed
  custom title and returns `{sessionId, summary}`. The source server rejects
  empty titles and values over 500 characters. The hub waits for success, then
  patches polled sessions, project-pagination extras, and the active chat target
  in memory; a later poll or reload reads the same persisted title.
- **Codex sessions** run server-side through the local Codex 0.146.x-0.147.x
  app-server adapter, the only structured Codex conversation runtime.
  `CODEX_CLI_PATH` is the
  explicit override; otherwise
  fleet-server compares PATH with bundled macOS ChatGPT/Codex application CLIs
  and selects the newest numeric version. This prevents an older PATH CLI from
  parsing a newer shared `~/.codex/models_cache.json` written by the desktop
  app. A missing or protocol-incompatible CLI fails before app-server spawn
  with an explicit error; there is no SDK or embedded-CLI fallback. App-server
  maps its command,
  file-change, managed-network, and supported question requests onto the
  provider-neutral permission protocol. `permissionMode` is remapped to a
  sandbox — default→workspace-write+ask-untrusted, acceptEdits→never-ask,
  bypass→danger-full-access, and the plan toggle→`read-only`. The mode select
  is relabeled, and app-server turns display their effective returned policy
  and sandbox next to it so managed overrides are explicit.
  App-server `turn/plan/updated` notifications render as one live `TodoWrite`
  checklist whose rows update in place from pending through completion.
  Plan mode is supported, but since Codex emits no `ExitPlanMode` request to
  drive `PlanPanel`, a completed plan-mode run shows a lightweight "plan
  ready" Build card in the transcript instead (Build leaves plan mode and
  sends a go-ahead so the same thread resumes writable). `toolsSettings`
  is ignored (not sent), live `tool_use` frames carry results inline
  (`output`/`exitCode`, no `tool_result` frame; repeated tool and reasoning ids
  are upserted in place by `appendMessage`), history serializes `toolInput` as
  a JSON string
  and `toolResult.content` sometimes as `{type,text}[]` parts, history shell
  tools are named `exec_command`/`exec`/`write_stdin`, skills are
  `$`-prefixed. Existing chats populate the header usage chip from the REST
  token-usage endpoint on open, and a turn-end
  `status {text:'token_budget'}` frame replaces that snapshot with the latest
  live occupancy. Empty Claude/Codex chats preflight
  `GET /api/providers/:provider/auth/status`. A reported missing CLI or
  signed-out state blocks the composer and renders the provider-owned recovery
  command with copy/retry actions; a failed or unsupported preflight fails open
  so stock/older hosts can still send and surface their normal runtime error.
- Model catalog: `GET /api/providers/:provider/models` →
  `{OPTIONS:[{value,label,description?,effort?}], DEFAULT}`; the chosen
  model+effort is stored per `hostId:provider` (legacy bare-hostId entries
  still read for claude) and sent in `chat.send` options. The `ModelSelect`
  picker renders each option's `description` inline (the exact model version,
  e.g. "Opus 4.8 with 1M context · …"). For claude, fleet-server ≥0.3.0
  populates this list dynamically from the CLI (`query().supportedModels()`)
  instead of a hardcoded set, so newly released models appear without a code
  change; the result is cached ~1h and there is no static fallback (a probe
  failure surfaces as an API error). `fleethub.v1.lastProvider` (per host)
  seeds the project pane's provider picker and the sidebar quick-create "+".
  Codex follows the same dynamic contract through app-server `model/list`,
  also cached ~1h; a missing or incompatible CLI surfaces an error instead of
  returning reconstructed disk-cache models.
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

### Git (`GitPanel` + `GitHistory`)

- All Git calls go through `lib/api.ts` and the authenticated `/api/git/*`
  routes. Several legacy routes return HTTP 200 with `{error}`, so the shared
  `gitJson` wrapper promotes those bodies to client errors.
- Changes uses `GET /api/git/status`, `/branches`, `/remote-status`, and
  `/diff`; mutations stay serialized through one busy state before refreshing
  status and any open file diff.
- History is lazy: `GET /api/git/commits?project=<id>&limit=<n>` returns up to
  100 commits across branches, remotes, and tags in topological order. Each
  entry includes parents, refs, author/date, subject, and one `--shortstat`
  summary. The Hub starts at 20 and expands the bounded window by 20.
- Selecting a commit calls
  `GET /api/git/commit-diff?project=<id>&commit=<hash>`. fleet-server validates
  the ref and runs `git show --format= --patch --no-ext-diff`, returning only a
  unified patch plus `isTruncated`; responses are capped at 500,000 characters
  so the shared diff renderer cannot be overwhelmed. Merge commits with no
  patch surface an explicit empty state.

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
  resolve against the project root. The inherited multipart
  `POST .../files/upload` accepts up to 20 files at 200 MB each and preserves
  binary bytes; fleet-server hardens its validation/overwrite semantics in
  `[fork-fix #20]`.
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

**Historical root cause — different Codex client surface.** Before the native
cutover, Agents Hub drove Codex through `@openai/codex-sdk`. The resulting
provider-native threads wrote normal Codex rollout JSONL under
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

**Verified bridge (Codex CLI 0.146.0, 2026-08-02).** The official Codex
app-server is the supported rich-client integration surface for authentication,
conversation history, approvals, and streamed events. A local stdio spike used
a custom `agents_hub_spike` client (without imitating a first-party identity) to
create and complete a thread in this repository. App-server persisted it with
source `vscode`, returned it from default and explicit-`vscode` `thread/list`,
and the Codex desktop app's own recent-task list returned the same id, title,
preview, `cwd`, and timestamps. It was not returned by the explicit
`appServer` source filter. This proves current same-machine desktop visibility
when Agents Hub drives the thread through app-server from the start, although
the surprising source classification is not yet treated as a cross-version
guarantee. The same spike confirmed that `model/list` is a richer source of
picker truth and `thread/tokenUsage/updated` carries an exact
`modelContextWindow`.

There is still no stable `thread/import` or `thread/register` method for
converting an already-created SDK rollout into a native desktop task. Existing
SDK-era rollouts remain readable and resumable by provider id, while all new
and resumed Agents Hub turns use app-server. The staged migration evidence is
in `docs/codex-app-server-spike-2026-08-02.md`. Cycle 2 decision
`D-37-ssh-host-authorization` choice C accepts the existing local-only evidence
for the SSH verification gate; it does not authorize access to or modification
of a remote host.

**Adapter status (2026-08-03).** The first implementation slice lives under
`fleet-server/server/modules/providers/list/codex/`: `codex-app-server-client.ts`
supervises one local `codex app-server --listen stdio://` child and implements
the JSONL lifecycle, while `app-server-protocol/` contains only the generated
0.147 types currently consumed by the adapter. A regenerated 0.147 schema diff
confirmed that the consumed wire shapes remain compatible with 0.146.
Initialization identifies the
client as `agents_hub` / `Agents Hub`, opts into no experimental capabilities,
correlates responses by id, bounds pending requests, and rejects in-flight work
on timeout, transport failure, stop, or process exit. Provider stderr is drained
but never logged because it may contain user or authentication data.

`CodexProviderModels` constructs the app-server client directly when the
existing provider-model endpoint refreshes its Codex catalog. It pages through
picker-visible `model/list` rows and maps the provider's order,
explicit default, display metadata, reasoning efforts, personality capability,
and input modalities onto the CloudCLI-compatible model response. Codex and
Claude process-backed catalogs use a one-hour backend cache. A failed spawn,
incompatible protocol, invalid response, or empty catalog fails clearly; the
old reconstructed `~/.codex/models_cache.json` fallback is gone.

The client accepts the verified Codex CLI 0.146.x-0.147.x range,
with a generated 0.147 protocol baseline, and fails before spawn for other
minor versions. This deliberately fail-closed gate must be updated along with
regenerated consumed types after compatibility verification. App-server remains
strictly behind the authenticated fleet-server REST/WebSocket boundary.

`codex-app-server-conversation.ts` is the next internal boundary. It sequences
`thread/start` or `thread/resume` followed by `turn/start`, accepts an arbitrary
host-local `cwd`, and returns the provider-native thread id plus the effective
model, approval policy, sandbox, reasoning effort, and working directory from
the app-server response. Its notification loop filters by thread and turn,
streams `item/agentMessage/delta` (falling back to a completed agent message
when no delta arrived), maps `thread/tokenUsage/updated.last` together with the
exact `modelContextWindow`, and tracks `commandExecution` items from their
started notification through ordered output deltas to the authoritative
completed item. Command output accumulated before completion is retained when
the final item omits `aggregatedOutput`. It also tracks `fileChange` items from
`item/started` through replacement `item/fileChange/patchUpdated` change lists
to the authoritative completed item. `webSearch` start/completion items likewise
become lifecycle events carrying the provider query and action; opaque result
payloads are not forwarded to the browser. `mcpToolCall` items are keyed by
their provider item id from start through progress and completion. They preserve
the server, tool name, arguments, textual progress/result, error message, and
duration; only string or `{text}` result-content blocks cross the boundary, so
structured content, `_meta`, app context, plugin ids, and binary blocks never
enter the browser protocol. The loop surfaces generic and
configuration warnings and terminates only on the matching `turn/completed`.
Matching `turn/plan/updated` notifications preserve their optional explanation
and validated non-empty steps, filtering malformed statuses before they reach
the runtime. `collabAgentToolCall` items validate the 0.146 collaboration
action/status enums and preserve sender/receiver ids, prompt, requested
model/effort, and safe target-agent states from start through completion.
Each turn requests `summary: 'auto'`, accumulates indexed readable reasoning
summary deltas across section boundaries, and replaces them with the completed
summary. Raw reasoning content and `item/reasoning/textDelta` are intentionally
ignored. The loop never invents a context window when app-server reports none.

`shared/pending-permissions.ts` now owns pending interaction state for every
provider. Entries are scoped by provider plus provider-native session id, so
`chat.subscribe` can reconstruct the authoritative pending cards after a
reconnect without cross-provider id collisions; `chat.permission-response`
resolves the same shared registry. Claude uses this service with its existing
timeouts, cancellation frames, and UI message shapes, replacing its former
private resolver map without changing behavior.

`codex-app-server-interactions.ts` maps the 0.146 server requests that fit the
existing Hub interaction contract: command execution to `Bash` (or
`NetworkAccess` when managed-network context is present), file changes to
`Edit`, and non-secret option-based `item/tool/requestUserInput` prompts that
allow a free-form answer to the existing `AskUserQuestion` card. Allow,
always-allow, and deny become
`accept`/`acceptForSession`/`decline`; cancellation becomes `cancel`; question
answers are translated from the UI's question-text keys back to app-server's
question ids. Requests for another active thread/turn, secret questions,
free-form-only questions, option prompts that disallow free-form answers,
permission grants, MCP elicitation, dynamic tools, and every other unsupported
method fail closed. Pending entries are also aborted when the conversation
runner stops.

`codex-app-server-runtime.ts` is the production protocol adapter. It accumulates
assistant deltas per item and emits final text through the existing normalized
writer, forwards exact token budgets, effective settings, warnings, approvals,
errors, and exactly one terminal frame, and registers the provider-native id so
reconnect and abort lookup use the same identity. Each command lifecycle update
becomes the existing normalized `tool_use` shape with tool name `Bash`, the
stable app-server item id, command/cwd/action input, inline output, status, and
final exit/duration metadata. ChatPane's same-id upsert therefore updates one
tool row rather than appending lifecycle duplicates. File-change lifecycle
updates use the same rule with tool name `FileChanges` and raw app-server
`{path, kind, diff}` change arrays; `ToolCall` renders each unified diff with
add/delete/edit/move metadata. The completion refresh normally swaps live ids
for canonical JSONL history, but carries forward any live `FileChanges` payload
that the rollout omitted, deduplicating it when canonical history does contain
the same id or payload. Reasoning summary lifecycle updates use the normalized
`thinking` kind and the stable app-server item id, so ChatPane grows one
collapsed row rather than appending delta duplicates. Web searches use the same
stable-id rule with the existing `WebSearch` tool renderer. App-server rollouts
persist those hosted searches as `exec` custom-tool wrappers around
`tools.web__run`; the Codex history reader recognizes that conservative shape
without evaluating recorded JavaScript and restores the native search query on
completion/reload. MCP lifecycle updates likewise become same-id generic tool
rows whose subtitle is the MCP server. Canonical rollouts persist MCP calls as
`exec` wrappers around static `tools.mcp__SERVER__TOOL(...)` calls followed by
opaque `custom_tool_call_output`; the history reader uses a balanced inert-text
scanner (never `eval`) to recover only the identifier and argument source from
that verified static shape and drops the matching opaque output. The same
scanner recognizes static `tools.exec_command({cmd: "..."})` wrappers as
native `Bash` rows with their result. Other Code Mode `exec` wrappers become a
compact `Code Mode` row and discard their opaque internal output, so recorded
orchestration JavaScript is never presented as a shell command. Plan updates
use a deterministic per-turn id and the existing `TodoWrite` renderer; the
runtime translates app-server
`inProgress` to the Hub's `in_progress` status and completes the row only when
every step is complete. A later update with no explanation keeps the last
provider explanation visible. Canonical rollouts persist Code Mode plan changes
as static `tools.update_plan({...})` wrappers rather than
`turn/plan/updated`. The history reader inertly validates that exact plan shape,
maps statuses to `TodoWrite`, collapses repeated updates in one turn to the
latest checklist, reuses the live deterministic turn id, and suppresses the
matching opaque outputs. Completion reconciliation and a later full reload
therefore show the same native checklist without executing recorded JavaScript.
Collaboration updates use one stable `Agent` tool row per app-server item. The
live row shows the provider action, prompt, model/effort, receiver ids, and
target status/message. Canonical rollouts persist the same operations as
ordinary `function_call` items named `spawn_agent`, `send_input`,
`resume_agent`, `wait_agent`, or `close_agent`; the history reader maps only
those exact names back to `Agent` rows so completion refreshes and reloads do
not expose raw tool names. It keeps safe scalar arguments and tool output while
dropping the opaque encrypted `message` argument, which is not displayable
prompt text.
Image-view start/completion items use the same stable-id rule and become a
compact `ViewImage` row containing only the provider path. App-server rollouts
persist the same operation as an `exec` custom-tool wrapper around
`tools.view_image(...)`, followed by a `custom_tool_call_output` that can contain
the full base64 image. The history reader recognizes only that static wrapper,
extracts its quoted path without evaluation, and suppresses the matching output,
so completion refreshes and reloads keep the native row without sending image
bytes to the browser.
Context-compaction start/completion items likewise update one stable
`ContextCompaction` row. The Hub presents this as a passive “Context compacted”
marker rather than a control: it does not request compaction or mutate the
thread. Canonical Codex rollouts persist compaction as a top-level `compacted`
entry whose `replacement_history` is provider-owned context state. The history
reader inspects only the entry type and timestamp, reconstructs the same marker,
and never forwards or parses that payload into the browser transcript.
An active abort signal sends `turn/interrupt`;
runtime cleanup suppresses a duplicate terminal frame after the gateway has
acknowledged the stop.

`server/index.js` registers this runtime directly for every Codex send and
abort. There is no alternate SDK router or same-send fallback: replaying a
possibly-started prompt through a second runtime could duplicate work, and
protocol-incompatible CLIs must fail explicitly. Rollback is a Git revert or a
prior fleet-server release. App-server stays strictly behind fleet-server
rather than being exposed to the browser.

An ephemeral read-only live turn confirmed the runner captures the effective
managed fallback (`never` requested, `untrusted` returned), its warning,
assistant deltas, and exact token budget.
A second ephemeral probe attempted one temp-file command: app-server emitted a
real `item/commandExecution/requestApproval`, the bridge returned `decline`,
the turn completed as denied, and the target file was not created.
A source-UI run then approved two harmless shell commands. The structured
transcript rendered their app-server command lifecycle as `Bash` rows with
complete inline output, while the resulting thread remained visible as a
native task in the Codex app.
A later source-UI run approved one `apply_patch` edit. The transcript showed
the app-server `FileChanges` row as a one-line unified diff before approval and
retained it after the turn completed even though that transient item was absent
from the canonical JSONL refresh.
A high-effort source-UI turn then emitted one readable reasoning summary. The
Hub rendered it as one collapsed `thinking` row, updated by stable id, while raw
reasoning remained absent from the normalized protocol and transcript.
A cached-search source-UI turn emitted two native `webSearch` lifecycles. The
Hub showed both as compact `Search` rows during execution and, after a full page
reload, restored the same queries from canonical rollout history instead of
exposing the internal `tools.web__run` wrapper as Bash.
An MCP-only source-UI turn then used `openaiDeveloperDocs`. Search and fetch
calls appeared as stable native rows labelled with that server during execution.
After rebuilding fleet-server and navigating away before a clean reload, the
same calls were reconstructed from canonical rollout wrappers; no
`tools.mcp__...` call was exposed as Bash. Structured and binary MCP result
payloads stayed outside the normalized transcript.
A plan-mode source-UI turn then emitted repeated `turn/plan/updated`
notifications for native task `77320d1f-3237-4537-9f93-5ea86f377058`. The Hub
showed one checklist at `0/3` while the turn was active, updated that same row
to `3/3`, and retained it after `PLAN_OK` and the delayed completion refresh.
A later Code Mode plan probe used native task
`cb659f4d-ce70-43cb-b700-0d6e2f464e8b`. After a clean server restart and full
page reload, canonical history restored exactly one `Todo list · 2/2` row beside
`AUDIT_PLAN_OK`. A separate MCP probe restored its internal `ALL_TOOLS`
discovery as a compact `Code Mode` row, while the following
`openaiDeveloperDocs` search/fetch calls kept their server-labelled native rows
and the raw JavaScript and opaque discovery output remained absent.
A single-subagent source-UI turn then created parent task
`2e9ce4a8-92f1-4571-b989-f52044bd55d2` and child task
`019fc79a-350b-72c2-9a0e-f546d88e78fc`. The active transcript showed the
provider `Wait for agents` lifecycle. After rebuilding the source server and
loading the parent session afresh, canonical history rendered exactly `Spawn
agent · confirm` and `Wait for agents` rows beside `COLLAB_OK`; the raw
`spawn_agent`/`wait_agent` names, encrypted prompt payload, and transient
duplicate were absent.
A later one-subagent turn confirmed that 0.146 `subAgentActivity` items emit a
separate child-agent activity lifecycle. The runner validates the exact
`started`/`interacted`/`interrupted` kind plus child thread id and agent path,
then maps start/completion onto one stable `Agent` row. Canonical rollouts keep
the collaboration function calls but not these activity markers, so ChatPane
retains live activity across completion reconciliation for the mounted
transcript; a later full reload cannot reconstruct an item the provider did not
persist. Parent task `019fc7b5-f68c-7140-8352-b3dbf3fee439` displayed `Agent
started · /root/activitycheck` with child task
`019fc7b6-1785-7370-b07e-ef1783103d5a` beside `ACTIVITY_OK`.

Codex also writes a standalone rollout for each child agent. Its initial
`session_meta` identifies the relationship explicitly with
`thread_source: "subagent"` and `parent_thread_id`; guardian/internal children
use the same thread source while their `source.subagent` payload differs. The
Codex synchronizer persists this as `sessions.isTopLevel = 0` plus
`parentSessionId`. Ordinary session queries, pagination/counts, archived-list
queries, global search input, and `session_upserted` broadcasts accept only
top-level rows, so child rollouts cannot enter the sidebar, project page, or
All sessions through either initial loading or the filesystem watcher. This is
an explicit metadata contract, never a title or path heuristic.

Hidden child rows and their JSONL paths remain in the database. Direct
`GET /api/providers/sessions/:sessionId/messages` history reads still resolve
them by id, and permanent project cleanup deliberately uses the unfiltered
repository query so hidden rows cannot be orphaned. Parent Agent rows are
unchanged because they are reconstructed from the parent transcript's
collaboration calls/activity, independently of child-session discovery.

`GET /api/providers/sessions/:sessionId` is the matching exact-id metadata
lookup. It returns the owning project, provider, title, timestamps, archive
state, and top-level flag without changing discovery. The Hub uses it only when
an incoming session hash names an active project but its session is absent from
that project's discovery page; archived or cross-project results remain closed.

Codex transcript order follows persisted JSONL sequence, not record timestamps.
Current paginated rollouts use `ordinal` as each normalized row's stable source
position; legacy rollouts use the physical line index. This keeps repeated
identical prompts distinct across API refreshes and React reconciliation even
when their content and timestamps match. Only canonical
`event_msg/user_message` records with absent or `plain` kind become visible user
turns. User-role `response_item/message` records are model-input history and are
not a safe user boundary: they can duplicate the prompt or carry developer,
environment, and subagent context, so the transcript never forwards them.

A source-UI image-view turn then created native task
`019fc7cf-d975-7f10-a81a-f36bc4f4c804`. After a clean server rebuild and page
reload, its transcript showed one compact `View image` row for
`fleet-hub/src-tauri/icons/64x64.png` beside `IMAGE_VIEW_OK`; the internal
`tools.view_image` wrapper and base64 tool output were absent.
A source-UI history check against an isolated synthetic rollout then rendered
one compact `Context compacted · Earlier messages were summarized` row beside
`COMPACTION_HISTORY_OK`. A sentinel stored only inside `replacement_history`
was absent from the DOM. The synthetic session, host entry, and source-server
data were removed after verification.

The native cutover was reverified on Codex 0.147.0 with no feature flag or SDK
dependency present. An ephemeral read-only turn returned the exact expected
assistant text, effective managed settings, and `17,784 / 258,400` latest-turn
usage. The current source Hub, pointed at an isolated source fleet-server,
loaded all seven app-server models and the Codex permission modes without a
send, browser error, or warning. No SSH host was touched.

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

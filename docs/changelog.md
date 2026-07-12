# Changelog

All notable changes to this workspace. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); newest entries first.
Agents: add an entry here after every substantive change (see AGENTS.md).

## 2026-07-12

### Added
- **Codex provider support** — Codex sessions can now be started and driven
  correctly from the hub (verified live against localhost CloudCLI 1.36.1,
  incl. rendering real Codex transcripts and creating a session):
  - Model/effort choice is now stored per `hostId:provider` (was per host —
    a stored Claude model id would have been sent to Codex runs). Legacy
    bare-hostId entries still apply to Claude. (`lib/storage.ts`,
    `ChatPane.tsx`)
  - Codex chats hide the Plan pill / Shift+Tab toggle (CloudCLI silently maps
    `permissionMode:'plan'` to default for codex), relabel the permission
    modes to their sandbox meanings (Sandboxed · ask untrusted / Sandboxed ·
    never ask / Full access — same stored values), and skip `toolsSettings`
    in `chat.send` (ignored by the codex runner). (`ChatPane.tsx`)
  - Codex tool calls render properly: live `Bash` frames carry results inline
    (`output`/`exitCode` on the tool_use — no `tool_result` frame; the same
    id can be re-emitted on completion, which `appendMessage` now upserts in
    place instead of dropping); history replay tools `exec_command`/`exec`/
    `write_stdin` render as terminal rows; `FileChanges`, `TodoList`,
    `WebSearch` mapped to the existing renderers. Two data-shape quirks
    verified against real transcripts: codex history serializes `toolInput`
    as a **JSON string** (now parsed; previously even codex `Edit` diffs
    rendered empty) and `toolResult.content` can be an **array of
    `{type,text}` parts** (previously crashed `ResultBlock.trim()`).
    (`ToolCall.tsx`, `types.ts`, `ChatPane.tsx`)
  - `$`-prefixed Codex skills complete in the composer (` $` at message
    start, like `/`); the `.claude/commands` catalog is fetched only for
    claude sessions. (`useComposerAutocomplete.ts`)
  - New sessions default to the provider last picked on that host
    (`fleethub.v1.lastProvider`): ProjectPane's picker starts there and the
    sidebar quick-create "+" follows it (tooltip shows the provider).
    (`ProjectPane.tsx`, `App.tsx`, `Sidebar.tsx`)
  - Empty Codex chats preflight `GET /api/providers/codex/auth/status` and
    banner a missing install / login instead of failing on first send;
    Codex `token_budget` status frames render as a context-usage chip in the
    chat header. (`ChatPane.tsx`, `lib/api.ts`)

### Fixed
- **Zombie plan/question cards resurrected by mid-run replay**: subscribing
  to a *running* session with `lastSeq: 0` (every ChatPane mount — refresh,
  or navigating back into the chat) makes CloudCLI replay the run's whole
  event log, including `permission_request` frames that were **already
  resolved**; the hub re-added each one as a live card, so an approved plan
  came back as "Plan ready for review" and an answered question as
  unanswered (clicking them again no-ops — the server resolver is gone).
  The `chat_subscribed` ack arrives before the replay and carries the run's
  current `lastSeq`, so ChatPane now records it (`ackedRunSeq`) and drops
  replayed `permission_request` frames at `seq <= ` that mark — genuinely
  pending ones still arrive via the ack's authoritative `pendingPermissions`.
  Seq numbers restart at 0 for each run (`chat-run-registry.startRun`), so
  the mark resets on `complete`, on send, on mount, and on idle acks —
  otherwise it would swallow the next run's live prompts. Root-caused and
  verified live against localhost CloudCLI 1.36.1. (`ChatPane.tsx`)
- **Stale permission/question cards after answering elsewhere**: CloudCLI
  emits no frame when a pending permission is resolved by another client
  (`permission_cancelled` fires only on timeout/abort), and each run's live
  stream goes to *one* socket — another client's `chat.subscribe` silently
  steals it, including the `complete` that used to clear the hub's cards. The
  hub now treats `chat_subscribed.pendingPermissions` as the authoritative
  full set (replace, never merge) and re-sends `chat.subscribe` on the
  existing 15 s fallback poll (idempotent — replay is `seq > lastSeq`), so
  cards answered from CloudCLI's own UI clear within ~15 s and the live
  stream is re-attached. Verified live end-to-end against localhost CloudCLI.
  (`ChatPane.tsx`)
- **Lost permission answers on a dead socket**: `respondQuestion` /
  `respondPermission` / `respondPlan` ignored `ChatSocket.respondPermission`'s
  return value and removed the card optimistically — an answer sent while the
  WS was reconnecting (or a zombie) was silently dropped and the agent waited
  forever. They now keep the card and show a "not delivered, try again" banner
  when the send fails. (`ChatPane.tsx`)
- **App-crashing image attachments**: messages sent from CloudCLI's own UI
  carry images inline as `{data: 'data:image/…;base64,…'}` with no `path`;
  `AuthedImage` crashed on `path.split(…)` and, with no error boundary, blanked
  the whole app for any session containing one. `NormalizedMessage.images` now
  allows both shapes and `MessageItem` renders inline `data:` images directly.
  (`types.ts`, `Messages.tsx`)

### Changed
- **Sidebar readability**: all sidebar type bumped one step (session titles
  13→14px, project names 14→15px, host headers 13→14px, timestamps/badges
  11→12px, archived rows 12→13px with 11px sub-lines) with icons scaled to
  match; the deep `pl-10` (40px) session/archived indent replaced by a
  vertical indent-guide line under the folder column (`ml-[13px] border-l`)
  with `pl-3`/`pl-6`, so titles get ~27px more room; default sidebar width
  288→304 (stored widths unaffected). Variants compared in
  `docs/sidebar-readability-proposal.html`. (`Sidebar.tsx`,
  `lib/storage.ts`)
- **Wider chat messages** (backlog item 3): removed the inner `max-w-[46rem]`
  cap on assistant markdown and thinking blocks (now `min-w-0`), raised the
  chat column and composer from `max-w-[54rem]` to `max-w-[80rem]`, and
  shrank the `px-6` gutters to `px-4`, so text, tool cards, and diffs use
  nearly the full pane like CloudCLI's web UI. (`ChatPane.tsx`,
  `Messages.tsx`)

### Added
- Version bumped to 0.1.3 (`package.json`, `tauri.conf.json`, `Cargo.toml`),
  tagged `v0.1.3` (plan mode toggle + plan drawer).
- **Plan mode toggle + plan drawer**: plan mode is no longer one of the
  permission-mode select options but an independent composer toggle
  (Shift+Tab), persisted per host in `fleethub.v1.planMode` (a legacy stored
  `permissionMode: 'plan'` migrates on read). While on, `chat.send` still goes
  out with `permissionMode: 'plan'`; approving a plan switches the toggle off
  so the next message doesn't silently re-enter plan mode. A finished plan
  (ExitPlanMode request) now opens as a docked right-hand drawer
  (`PlanPanel.tsx`) with the decision buttons in its header, so the plan stays
  visible while the chat scrolls; the transcript shows a small "Plan ready for
  review" chip that reopens the drawer. `PlanDecision` moved to `types.ts`.
  (`ChatPane.tsx`, `PlanPanel.tsx`, `lib/storage.ts`, `types.ts`)
- **Chat side panels (files & git)**: Cursor/Codex-style instant access to the
  project's file system and source control straight from a chat. Two toggle
  buttons in the chat header (folder tree / git branch icons) dock the existing
  `FileBrowser` or `GitPanel` to the right of the conversation as a resizable
  panel (drag the left edge; min 480px, up to 70% of the window). The panels
  gained an `embedded` mode (close icon instead of back-navigation, narrower
  left column); panel choice and width persist in localStorage
  (`fleethub.v1.chatPanel`). The full-screen views via the project pane are
  unchanged.
- **Desktop app (Tauri 2)**: `fleet-hub/src-tauri/` wraps the SPA as a native
  app ("Agents Hub", identifier `io.github.pfedotovsky.agents-hub`). No Rust
  logic beyond the stock shell — the frontend is unchanged and still talks to
  CloudCLI hosts directly. `npm run tauri dev` for a native window,
  `npm run tauri build` for bundles.
- **Release pipeline**: pushing a `v*` tag runs `.github/workflows/release.yml`
  (tauri-action), which attaches a universal macOS `.dmg` and Linux
  AppImage/deb/rpm to a GitHub Release. macOS signing/notarization activates
  automatically once `APPLE_*` repo secrets are set; until then builds are
  unsigned (Tauri ad-hoc signs). Gotcha fixed en route: missing GitHub secrets
  arrive as *empty strings*, which Tauri treats as "please sign" — the workflow
  now exports `APPLE_*` env vars only when non-empty.
- **Homebrew tap**: `pfedotovsky/homebrew-tap` with `Casks/agents-hub.rb` —
  `brew install --cask pfedotovsky/tap/agents-hub` (v0.1.0 released and
  verified end-to-end). Release bump = update `version` + `sha256` in the cask.
- Version bumped to 0.1.2 (`package.json`, `tauri.conf.json`, `Cargo.toml`),
  tagged `v0.1.2` (chat side panels + AskUserQuestion cards); v0.1.1 was
  released earlier the same day.
- P1 feature-parity batch (all verified live against CloudCLI 1.36.1 on
  localhost:3001):
  - **True running indicator**: each 12s fleet poll now also fetches
    `GET /api/providers/sessions/running` (status-only, app-facing ids) and
    stores `runningSessionIds` on `HostRuntime`. Sidebar/feed/project rows show
    a "running" badge only for sessions the host reports as processing; the old
    2-minute `lastActivity` heuristic (`isActive`) remains solely as a fallback
    for hosts that don't expose the endpoint (`sessionLive` in `lib/format.ts`).
  - **Session archive / restore / permanent delete**: hover archive action on
    sidebar session links, feed rows, and project-pane rows (optimistic removal,
    `DELETE /api/providers/sessions/:id`); per-host "Archived" collapsible at
    the bottom of each host section lazy-loads `GET .../sessions/archived` with
    Restore (`POST .../restore` + host re-poll) and a two-step
    "delete forever?" confirm (`DELETE ?force=true`, removes the transcript
    from the host's disk). Archiving the open chat navigates back.
  - **Full-text conversation search (⌘K)**: overlay fanning
    `GET /api/providers/search/sessions` (an SSE stream, consumed via fetch +
    ReadableStream since EventSource can't send the Bearer header) out to every
    online host concurrently; results stream in grouped host → project →
    session with `<mark>` highlights from the server's match offsets, per-host
    scan progress, ↑↓/Enter navigation. Also a search icon in the sidebar
    header. (`lib/search.ts`, `components/SearchOverlay.tsx`)
  - **Image attachments in chat**: paste, drag-drop, or attach-button on the
    composer uploads to `POST /api/assets/images` (mirrors host limits: 5
    files × 5MB, jpeg/png/gif/webp/svg) and shows thumbnail chips; send passes
    stored-asset descriptors in `chat.send` `options.images`. History and
    optimistic user bubbles render `message.images` through `AuthedImage`,
    which blob-fetches `GET /api/assets/images/:filename` with the Bearer
    header (plain `<img>` can't) and caches object URLs; just-uploaded previews
    seed that cache so sent images render instantly.
  - **Git panel**: per-project view next to Files (new `git` View kind) —
    branch switcher + create-branch, ahead/behind with fetch/pull/push (or
    publish `--set-upstream` when no upstream), changed files grouped
    Staged/Changes/Untracked with per-file stage/unstage and commit checkboxes,
    commit box with AI message generation
    (`POST /api/git/generate-commit-message`), and a full-height unified-diff
    viewer (`Diff.tsx` gained a `unified`-text parsing mode alongside its
    old/new mode). Handles the API quirk of HTTP 200 + `{error}` bodies and
    shows a friendly not-a-repo state. (`components/GitPanel.tsx`,
    `lib/api.ts` git section)
- AskUserQuestion support (UX backlog #1): the agent's questions no longer
  land as a generic allow/deny prompt. `AskUserQuestion` permission requests
  (interactive server-side, like ExitPlanMode) render a question card — header
  chip, question text, one button per option with its description, multi-select
  toggling, and a free-text "Other" input per question; multiple questions in
  one request stack in a single card with a shared Answer button. A lone
  single-select question answers straight from the option click. Answers
  return through `chat.permission-response` as `updatedInput` — the original
  input plus `answers` keyed by question text, multi-select labels
  comma-joined (the shape the agent SDK's `AskUserQuestionInput` defines;
  verified from the SDK bundled with CloudCLI 1.36.1 and live end-to-end:
  single-select, multi-select, and free-text answers all echoed back exactly).
  Dismiss denies with "User dismissed the questions without answering";
  malformed question input falls back to the generic permission card, and the
  desktop notification says "question" instead of "wants to use
  AskUserQuestion". (`ChatPane.tsx` `QuestionCard`, `lib/chatSocket.ts`,
  `types.ts`)
- Plan mode support: `ExitPlanMode` tool calls now render as an
  "Implementation plan" markdown card (indigo, `input.plan`, success ack
  hidden), and its permission request — which the server always routes to the
  UI as interactive — gets a dedicated review card (plan markdown +
  "Approve & build" / "Approve, auto-accept edits" / "Revise") instead of the
  generic allow/deny prompt. Approving flips the persisted permission mode to
  default/acceptEdits (the server rebuilds SDK options from client options on
  every `chat.send`, so staying on 'plan' would silently re-enter plan mode on
  the next message); "Revise" denies with "User asked to revise the plan"
  (`chat.permission-response` now carries an optional `message`). Plan-ready
  desktop notifications say so instead of "wants to use ExitPlanMode".
  Verified end-to-end against local CloudCLI 1.36.1.
  (`ChatPane.tsx`, `ToolCall.tsx`, `lib/chatSocket.ts`)
- Composer autocomplete: typing `@` in the chat input opens a file picker over
  the project's file tree (project-relative paths, ranked filename-first), and
  `/` at the start of the message opens a skills + custom-commands picker
  (skills from `GET /api/providers/:provider/skills?workspacePath=`, commands
  from `POST /api/commands/list`; CloudCLI's frontend-only built-ins like
  /help are excluded). Arrow keys navigate, Tab/Enter insert (`@path ` /
  `/name `), Escape closes; catalogs load lazily on first trigger and are
  cached per chat target. Picked commands are sent as plain chat text — the
  Claude Code binary on the host expands slash commands/skills itself.
  (`hooks/useComposerAutocomplete.ts`, `ChatPane.tsx`, `lib/api.ts`, `types.ts`)

### Changed
- Sidebar readability pass to match the chat's new 12px type floor: session
  links 12px → 13px with `py-1.5` row height, host section headers and
  tail rows ("N more", "all N chats…", empty states) 12px → 13px,
  timestamps / session counters / status buttons / live chip 10px → 11px,
  wordmark 14px → 15px, and muted tail rows lightened one ink step
  (`ink-600` → `ink-500`). Default sidebar width 256px → 288px (existing
  saved widths untouched). (`Sidebar.tsx`, `lib/storage.ts`)
- Chat readability pass (informed by measuring CloudCLI's own UI — 868px
  column, 14px/24px prose — and Codex/Cursor conventions): the chat column
  widened from `max-w-2xl` (672px) to `max-w-[54rem]` (864px) with `px-6`
  pane padding; assistant prose bumped to 15px/28px (`text-[15px] leading-7`)
  but capped at `max-w-[46rem]` (~90 chars) for reading measure, while tool
  calls, diffs, Bash output, and permission cards lost their `mr-*` margins
  and now span the full column. User messages are Codex-style bubbles capped
  at `max-w-[75%]`. Type floor raised: nothing below 12px — tool row
  labels/subtitles/results and diff text 11px → `text-xs`, markdown code
  blocks 12.5px → 13.5px, markdown tables 12px → 13px, chat input 14px →
  15px. (`ChatPane.tsx`, `Messages.tsx`, `ToolCall.tsx`, `Markdown.tsx`,
  `Diff.tsx`)

### Fixed
- Chat unscrollable with the composer pushed off-screen: the wrapper div the
  side-panel feature added around `ChatPane` in `App.tsx` (`flex min-w-0
  flex-1`) sat in the column-flex `<main>` without `min-h-0`, so its
  `min-height: auto` let it grow to the full height of the message history
  instead of the viewport — the outer `h-screen overflow-hidden` then clipped
  everything below, hiding the composer and killing the message list's
  scrollbar. Added `min-h-0` to the wrapper.

## 2026-07-11

### Fixed
- Chat drafts no longer vanish when switching chats: `ChatPane` is keyed
  per session and unmounts on navigation, so unsent input held in local
  state was lost. Drafts now persist to localStorage
  (`fleethub.v1.drafts`, keyed `hostId:sessionId`) via new
  `loadDraft`/`saveDraft` helpers in `src/lib/storage.ts` — written on
  every keystroke, cleared on send, and restored (with textarea resize)
  on mount. As a side effect drafts also survive page reloads.

### Changed
- Renamed the product Fleet Hub → **Agents Hub**: sidebar wordmark, browser
  title, new brass-beacon favicon, `package.json` name (`agents-hub`), and
  all doc mentions. Repo directory `fleet-hub/`, localStorage keys
  (`fleethub.v1.*`, so existing hosts/tokens survive), and internal
  identifiers (`useFleet`, `FleetSession`) intentionally unchanged.
- UI overhaul to an "ink & brass" theme: the zinc grays became a
  blue-graphite `ink-*` token scale (Tailwind v4 `@theme` in
  `src/index.css`), primary actions (send, new session, add host, sign in,
  checkbox accents, focus rings) moved from white buttons to a single brass
  accent, and fonts changed from Inter/JetBrains Mono to Space Grotesk
  (wordmark/pane titles), IBM Plex Sans (body), and IBM Plex Mono (data).
  The sidebar wordmark gained a live-agent counter chip ("N live", pulsing
  beacon) computed from the 2-minute activity window. Emerald active
  signals and the CVD-validated host identity palette are unchanged; both
  CSS animations now respect `prefers-reduced-motion`. All 15 components
  restyled; no behavior, data-flow, or API changes.

### Added
- One-click new session from the sidebar: each project row has a hover "+"
  button (next to the pin star, Cursor-Agents-style) that creates a session
  via `POST /api/providers/sessions` with the default `claude` provider and
  opens the chat immediately — no project-view detour. Spinner while
  creating; hidden when the host isn't online. Failures show a dismissible
  toast. The project pane keeps the provider picker for codex/opencode.

### Fixed
- Chat autoscroll actually sticks to the bottom now. The old check compared
  scroll position only at the instant a message frame arrived, so async
  height growth (markdown, syntax highlighting, diffs rendering after the
  frame) left the view stranded mid-transcript. Replaced with a pinned-to-
  bottom flag maintained by the scroll listener plus a `ResizeObserver` on
  the message column that re-snaps whenever content grows while pinned;
  scrolling up unpins, scrolling back down (or sending) re-pins.
- Permission mode is now persisted per host instance (`fleethub.v1.
  permissionModes`, keyed by hostId) instead of per host+project, so the
  chosen mode follows you across all projects on a VM; legacy per-project
  values are still read as a fallback. "Always allow" tool grants remain
  per host+project.
- Permission prompts kept coming back: the permission mode (e.g. bypass) was
  component-local state that silently reset to "Ask" on every chat remount,
  and approvals were one-shot because `chat.permission-response` never used
  CloudCLI's `rememberEntry` field. The mode is now persisted and restored
  on mount; the permission card gained an **Always allow** button that sends
  `rememberEntry` (`Edit`, or `Bash(<first word>:*)` prefix rules) and, since
  the server rebuilds SDK options from scratch on every `chat.send`, the hub
  re-sends accumulated grants as `options.toolsSettings.allowedTools` with
  each message. Verified against CloudCLI 1.36.1 `claude-sdk.js`: the server
  keeps no per-session permission state; it does load the VM's own
  `.claude/settings*` (`settingSources: ['project','user','local']`), so hub
  prompts only appear for tools the VM's own rules don't already allow.

### Added
- Resizable sidebar: drag the right edge (200–480 px), width persisted in
  `fleethub.v1.sidebarWidth`.
- Active-session indicators: sessions with activity in the last 2 minutes
  (the closest client-side proxy for a running agent — CloudCLI exposes no
  fleet-wide "is processing" signal without subscribing to every session)
  show a pulsing green "active" badge in the sidebar chat list and the
  session feed, and their project rows get a green dot. Projects with an
  active session sort above starred/recent ones in the sidebar.
- Completion/permission alerts: the open chat plays a short WebAudio chime
  and, when the tab is hidden, posts a desktop notification when a run
  finishes or a permission prompt appears. Toggle in Settings →
  Preferences (`soundAlerts` pref, on by default); Notification permission
  is requested on first send (user gesture).
- "Always allow" grants now also write through to the host project's
  `.claude/settings.local.json` (`permissions.allow`, claude provider only)
  via the file API, so grants apply to terminal Claude Code and the host's
  own UI too, and survive independently of the hub's localStorage.
  Best-effort: corrupt/unexpected JSON is never overwritten, and a missing
  `.claude/` directory (PUT can't create parents) degrades to hub-only grants
  with a banner. `FleetSession` now carries `projectId` for the file API.
- In-hub first-time setup: a host in `needs-setup` state now gets a "set up"
  action (sidebar hint + feed card) that opens the login modal in create-account
  mode — username/password + confirmation, client-side min-length checks
  mirroring the server's — and calls `POST /api/auth/register` (returns a JWT
  directly, so the host connects in one step). Previously the card linked to
  the host's own UI. `fetchJson` now surfaces the server's `error` message on
  non-auth failures (e.g. 409 username exists).
- Sidebar chats: each project row now has a disclosure chevron that expands
  its recent sessions inline (up to 6, newest first, from the already-polled
  embedded sessions — no extra API calls), Cursor/CloudCLI-style. Clicking a
  chat opens it directly; the active chat is highlighted and its project
  auto-expands (manual toggle overrides). An "all N chats…" link defers to
  the project pane for the full paged list.
- Initial Agents Hub SPA (`fleet-hub/`): multi-host CloudCLI client — sidebar
  with hosts → projects (starred + recency ordering), merged cross-host
  session feed, project view with paged sessions and new-session creation
  (claude / codex / opencode), live chat over `/ws` (streaming, tool-call
  rendering, permission prompts, abort, model + effort picker, permission
  modes, seq-replay reconnect), per-project file browser with CodeMirror
  editor, per-host JWT auth with sliding refresh, offline cards for
  hibernated remote VMs.
- Documentation set: `AGENTS.md`, `docs/architecture.md`, this changelog,
  plus a Stop hook that reminds agents to keep docs in sync.

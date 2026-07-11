# Changelog

All notable changes to this workspace. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); newest entries first.
Agents: add an entry here after every substantive change (see AGENTS.md).

## 2026-07-11

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
- Initial Fleet Hub SPA (`fleet-hub/`): multi-host CloudCLI client — sidebar
  with hosts → projects (starred + recency ordering), merged cross-host
  session feed, project view with paged sessions and new-session creation
  (claude / codex / opencode), live chat over `/ws` (streaming, tool-call
  rendering, permission prompts, abort, model + effort picker, permission
  modes, seq-replay reconnect), per-project file browser with CodeMirror
  editor, per-host JWT auth with sliding refresh, offline cards for
  hibernated remote VMs.
- Documentation set: `AGENTS.md`, `docs/architecture.md`, this changelog,
  plus a Stop hook that reminds agents to keep docs in sync.

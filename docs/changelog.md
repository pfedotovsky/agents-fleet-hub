# Changelog

All notable changes to this workspace. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); newest entries first.
Agents: add an entry here after every substantive change (see AGENTS.md).

## 2026-07-11

### Added
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

# Agents Hub vs. CloudCLI Web App — Feature Parity Report

*Compared: Agents Hub (this repo, `fleet-hub/`) vs. CloudCLI v1.36.1 web UI
(installed package at `/opt/homebrew/lib/node_modules/@cloudcli-ai/cloudcli/`).
First compared 2026-07-11; status last updated 2026-07-12.*

This file is canonical; `feature-parity.html` is a regenerated human view of
the same content. **Planned work lives in `docs/backlog.md`** — this document
is a status/comparison report only.

Agents Hub is a **multi-host aggregator** over per-VM CloudCLI APIs;
CloudCLI's own web UI is a **single-host** full-featured client. Some CloudCLI
features are server-side capabilities Agents Hub can adopt by calling existing
host APIs; others (plugins, Electron) are out of scope for a static hub SPA.

**Legend:** ✅ full · ⚠️ partial · ❌ missing · ➕ Agents Hub advantage

## Feature comparison

| Feature area | Agents Hub | CloudCLI web app | Notes |
|---|---|---|---|
| **Multi-host fleet view** | ✅ ➕ | ❌ | Hub's raison d'être: hosts → projects → sessions tree, cross-host session feed, per-host status polling, offline/hibernation handling |
| **Auth (login, first-run setup, JWT refresh)** | ✅ | ✅ | Parity; hub handles it per host, incl. `X-Refreshed-Token` sliding refresh and 401/403 handling |
| **Chat: send / stream / abort** | ✅ | ✅ | Parity over the same WS protocol; hub adds seq-replay resubscribe on reconnect ➕ |
| **Permission prompts & modes** | ✅ ➕ | ✅ | Hub adds durable "Always allow" per host:project **with write-through to `.claude/settings.local.json`**; per-host mode persistence |
| **Model + reasoning-effort selection** | ✅ | ✅ | Parity (per-provider catalog, per-host:provider persisted choice) |
| **Markdown / code highlighting / tool-call rendering** | ✅ | ✅ | Parity for GFM, Prism, diffs, todo checklists, Bash cards |
| **KaTeX math & Mermaid diagrams in messages** | ❌ | ✅ | CloudCLI bundles KaTeX + Mermaid |
| **Image attachments in chat** | ✅ | ✅ | Paste / drag-drop / attach button → `POST /api/assets/images`, sent via `options.images`; history renders via authenticated blob fetch |
| **Voice input (transcription)** | ❌ | ✅ | CloudCLI proxies audio to OpenAI transcription (`/api/voice`) |
| **Full-text conversation search** | ✅ ➕ | ✅ | ⌘K overlay fans the SSE `GET /search/sessions` out to every online host and merges streamed results — cross-host search CloudCLI can't do |
| **Session create** | ✅ | ✅ | Parity (one-click new session from sidebar ➕) |
| **Session delete/archive, restore, rename** | ⚠️ | ✅ | Archive (hover action), per-host Archived list with restore + permanent delete. Rename not implemented (host has `PUT /sessions/:id`) |
| **Running-sessions signal** | ✅ | ✅ | Polls `GET /sessions/running` per host (verified live); 2-min heuristic kept only as fallback for older hosts |
| **Project star/favorite** | ✅ | ✅ | Parity |
| **Project create / rename / delete / archive / git-clone** | ❌ | ✅ | Full REST routes incl. clone with progress stream |
| **File tree + editor (view/edit/save)** | ✅ | ✅ | Parity (CodeMirror both sides); hub adds Cmd+S, dirty guard |
| **File create / delete / rename / upload** | ❌ | ⚠️ | Neither is strong here; CloudCLI has image upload + shell as escape hatch |
| **Integrated terminal / shell** | ❌ | ✅ | CloudCLI: PTY over WS (`node-pty` + xterm.js), agent CLI or plain shell |
| **Git panel** | ⚠️ | ✅ | Hub: status, unified diffs, stage/unstage, commit (+AI messages), branches, fetch/pull/push/publish. Missing: commit history, discard, revert |
| **MCP server management** | ❌ | ✅ | Per-provider + global scopes, stdio/HTTP transports |
| **Slash commands** | ✅ | ✅ | `/` composer autocomplete over skills + `.claude/commands` (`POST /api/commands/list`); codex `$`-skills too ➕ |
| **Skills management** | ❌ | ✅ | List/add/delete per provider (hub only *lists* them in autocomplete) |
| **TaskMaster (tasks, PRD parsing, templates)** | ❌ | ✅ | Full `/api/taskmaster` suite |
| **Browser-use (Playwright automation)** | ❌ | ✅ | Optional runtime; niche for a hub |
| **Plugin system + marketplace** | ❌ | ✅ | Out of scope for a static SPA (plugins are host-side) |
| **Token usage / context-window display** | ⚠️ | ⚠️ | Hub shows a codex context chip from `token_budget` frames; no claude usage display. CloudCLI: capability flag in core, cost dashboard is a plugin |
| **Notifications** | ⚠️ ➕ | ✅ | Hub: WebAudio chime + desktop Notification (works fleet-wide). CloudCLI: Web Push (VAPID), desktop-via-WS, Discord, per-channel prefs |
| **Scheduled prompts / cron** | ❌ | ⚠️ | Optional `workspace-scheduled-prompts` plugin, not core |
| **Themes (light/dark)** | ❌ dark-only | ✅ | CloudCLI has appearance settings |
| **Mobile / responsive + PWA** | ❌ | ✅ | CloudCLI: responsive layout, manifest, service worker, standalone mode |
| **URL routing / deep links** | ❌ | ✅ | Hub navigation is in-memory only; no back-button or shareable URLs |
| **API keys / provider credentials management** | ❌ | ✅ | Host-admin feature; low value in hub |
| **Onboarding / git identity config** | ❌ | ✅ | Host-admin feature |
| **Electron desktop app** | ✅ | ✅ | Hub ships as a Tauri 2 desktop app ("Agents Hub", macOS + Linux) |

### Agents Hub advantages (no CloudCLI equivalent)

- Multi-host aggregation: one pane of glass over N VMs, cross-host activity feed, per-host color coding and status dots.
- Cross-host full-text search (⌘K) fanning out to every online host.
- Sessions from runs started elsewhere (terminal, host UI) flow in via `session_upserted` + fallback polling.
- Permission grants persisted per host:project and written through to the project's `.claude/settings.local.json`.
- Plan-mode toggle (Shift+Tab) with a docked plan drawer; AskUserQuestion answer cards.
- Offline/hibernating VM handling with retained last-known state and setup hints.
- One-click new session from the sidebar; drag-resizable sidebar; active-session-first ordering.

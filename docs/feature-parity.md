# Agents Hub vs. CloudCLI Web App — Feature Parity Report

*Compared: Agents Hub (this repo, `fleet-hub/`) vs. CloudCLI v1.36.1 web UI (installed package at `/opt/homebrew/lib/node_modules/@cloudcli-ai/cloudcli/`). Date: 2026-07-11.*

Agents Hub is a **multi-host aggregator** over per-VM CloudCLI APIs; CloudCLI's own web UI is a **single-host** full-featured client. Some CloudCLI features are server-side capabilities Agents Hub can adopt by calling existing host APIs; others (plugins, Electron) are out of scope for a static hub SPA.

**Legend:** ✅ full · ⚠️ partial · ❌ missing · ➕ Agents Hub advantage

## Feature comparison

| Feature area | Agents Hub | CloudCLI web app | Notes |
|---|---|---|---|
| **Multi-host fleet view** | ✅ ➕ | ❌ | Hub's raison d'être: hosts → projects → sessions tree, cross-host session feed, per-host status polling, offline/hibernation handling |
| **Auth (login, first-run setup, JWT refresh)** | ✅ | ✅ | Parity; hub handles it per host, incl. `X-Refreshed-Token` sliding refresh and 401/403 handling |
| **Chat: send / stream / abort** | ✅ | ✅ | Parity over the same WS protocol; hub adds seq-replay resubscribe on reconnect ➕ |
| **Permission prompts & modes** | ✅ ➕ | ✅ | Hub adds durable "Always allow" per host:project **with write-through to `.claude/settings.local.json`**; per-host mode persistence |
| **Model + reasoning-effort selection** | ✅ | ✅ | Parity (per-provider catalog, per-host persisted choice) |
| **Markdown / code highlighting / tool-call rendering** | ✅ | ✅ | Parity for GFM, Prism, diffs, todo checklists, Bash cards |
| **KaTeX math & Mermaid diagrams in messages** | ❌ | ✅ | CloudCLI bundles KaTeX + Mermaid |
| **Image attachments in chat** | ❌ | ✅ | CloudCLI: `POST /api/assets/images` + `supportsImages` on all providers; hub chat is text-only, no paste/drag-drop |
| **Voice input (transcription)** | ❌ | ✅ | CloudCLI proxies audio to OpenAI transcription (`/api/voice`) |
| **Full-text conversation search** | ❌ | ✅ | Host API exists: `GET /search/sessions` — hub has no search at all |
| **Session create** | ✅ | ✅ | Parity (one-click new session from sidebar ➕) |
| **Session delete/archive, restore, rename** | ❌ | ✅ | Host API: `DELETE /sessions/:id`, `POST /sessions/:id/restore`, archived list; rename likely via `session-manager` plugin |
| **Running-sessions signal** | ⚠️ | ✅ | Hub infers "active" from lastActivity < 2 min; host exposes `GET /sessions/running` (verify against live host — earlier finding said no such signal) |
| **Project star/favorite** | ✅ | ✅ | Parity |
| **Project create / rename / delete / archive / git-clone** | ❌ | ✅ | Full REST routes incl. clone with progress stream |
| **File tree + editor (view/edit/save)** | ✅ | ✅ | Parity (CodeMirror both sides); hub adds Cmd+S, dirty guard |
| **File create / delete / rename / upload** | ❌ | ⚠️ | Neither is strong here; CloudCLI has image upload + shell as escape hatch |
| **Integrated terminal / shell** | ❌ | ✅ | CloudCLI: PTY over WS (`node-pty` + xterm.js), agent CLI or plain shell |
| **Git panel** | ❌ | ✅ | Status, diff, stage/unstage, commit (+AI commit messages), branches, history, fetch/pull/push/publish, discard/revert |
| **MCP server management** | ❌ | ✅ | Per-provider + global scopes, stdio/HTTP transports |
| **Slash commands** | ❌ | ✅ | Custom `.md` commands exposed in composer (`/api/commands`) |
| **Skills management** | ❌ | ✅ | List/add/delete per provider |
| **TaskMaster (tasks, PRD parsing, templates)** | ❌ | ✅ | Full `/api/taskmaster` suite |
| **Browser-use (Playwright automation)** | ❌ | ✅ | Optional runtime; niche for a hub |
| **Plugin system + marketplace** | ❌ | ✅ | Out of scope for a static SPA (plugins are host-side) |
| **Token usage / context-window display** | ❌ | ⚠️ | Capability flag + UI strings in core; cost dashboard is an optional plugin |
| **Notifications** | ⚠️ ➕ | ✅ | Hub: WebAudio chime + desktop Notification (works fleet-wide). CloudCLI: Web Push (VAPID), desktop-via-WS, Discord, per-channel prefs |
| **Scheduled prompts / cron** | ❌ | ⚠️ | Optional `workspace-scheduled-prompts` plugin, not core |
| **Themes (light/dark)** | ❌ dark-only | ✅ | CloudCLI has appearance settings |
| **Mobile / responsive + PWA** | ❌ | ✅ | CloudCLI: responsive layout, manifest, service worker, standalone mode |
| **URL routing / deep links** | ❌ | ✅ | Hub navigation is in-memory only; no back-button or shareable URLs |
| **API keys / provider credentials management** | ❌ | ✅ | Host-admin feature; low value in hub |
| **Onboarding / git identity config** | ❌ | ✅ | Host-admin feature |
| **Electron desktop app** | ❌ | ✅ | Out of scope |

### Agents Hub advantages (no CloudCLI equivalent)

- Multi-host aggregation: one pane of glass over N VMs, cross-host activity feed, per-host color coding and status dots.
- Sessions from runs started elsewhere (terminal, host UI) flow in via `session_upserted` + fallback polling.
- Permission grants persisted per host:project and written through to the project's `.claude/settings.local.json`.
- Offline/hibernating VM handling with retained last-known state and setup hints.
- One-click new session from the sidebar; drag-resizable sidebar; active-session-first ordering.

---

## TODO — path to feature parity

Ordered by value ÷ effort. Items marked **[API ready]** need only frontend work against already-verified host endpoints.

### P1 — High value, host API already exists

- [ ] **Session delete/archive + restore** — `DELETE /api/providers/sessions/:id`, `POST .../restore`, archived list view. **[API ready]**
- [ ] **True "running" indicator** — poll `GET /api/providers/sessions/running` per host instead of the 2-minute lastActivity heuristic. Verify the endpoint against a live 1.36.1 host first (earlier live testing found no fleet-wide signal). **[API ready — verify]**
- [ ] **Full-text conversation search** — `GET /api/providers/search/sessions`, cross-host: fan out per host, merge results into the feed UI. **[API ready]**
- [ ] **Image attachments in chat** — paste/drag-drop → `POST /api/assets/images`, reference in `chat.send`; render image history in transcripts. **[API ready]**
- [ ] **Git panel** — status, diff viewer, stage/unstage, commit (incl. AI-generated commit message via `POST /api/git/generate-commit-message`), branch switch/create, pull/push. Full REST surface exists under `/api/git/*`. **[API ready]**
- [ ] **Project management** — create, rename, delete/archive+restore, and git-clone (with `/clone-progress` stream). **[API ready]**

### P2 — High value, more work

- [ ] **Integrated terminal** — xterm.js client against the host's shell WebSocket (`node-pty` PTY, resize, agent CLI or plain shell). Biggest single UX gap vs. CloudCLI.
- [ ] **URL routing** — hash- or path-based routes for host/project/session so views are deep-linkable and back-button works; prerequisite for PWA/mobile polish.
- [ ] **Mobile/responsive layout + PWA** — collapsible sidebar on small screens, manifest + service worker; pairs with Web Push below.
- [ ] **Web Push notifications** — subscribe to each host's VAPID push (`/api/settings/push/*`) so alerts arrive with the tab closed (current chime/Notification requires an open tab).
- [ ] **Token usage / context-window display** — surface per-session token usage where `supportsTokenUsage` (claude/codex/opencode).
- [ ] **Slash commands** — fetch `/api/commands` per project, autocomplete in the composer.
- [ ] **Session rename** — investigate mechanism (no core route found; possibly `session-manager` plugin); implement if a stable API exists.

### P3 — Nice to have

- [ ] **MCP server management UI** — per-provider + global list/add/remove over `/:provider/mcp/servers`.
- [ ] **Light theme / appearance settings** — currently hardcoded dark.
- [ ] **KaTeX + Mermaid rendering** in markdown messages.
- [ ] **File operations** — create/rename/delete files and folders (needs shell or new host support; `PUT file` can't create dirs).
- [ ] **Voice input** — mic capture → host `/api/voice` transcription proxy (requires host-side OpenAI key).
- [ ] **Skills management UI** — list/add/delete per provider.
- [ ] **TaskMaster integration** — task list + PRD tooling per project.
- [ ] **Conversation compaction** control (`compact`), if exposed over WS.

### Explicitly out of scope for a static multi-host hub

- Plugin system/marketplace, browser-use automation, Electron desktop build, API-key/credential admin, onboarding/git-identity setup — these are host-local or require a backend the hub deliberately doesn't have.

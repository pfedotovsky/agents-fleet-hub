# Backlog

**This file is the single source of truth for planned work.** Conventions
for agents:

- Check this file before starting feature work; if the work matches an item,
  do that item (and its listed pointers first).
- When an item ships: delete it here and record it in `docs/changelog.md`
  (per AGENTS.md → Documentation upkeep). Done items do not accumulate here.
- Discovered gaps, ideas, and follow-ups get added here as new items with
  pointers — never as new HTML planning docs. Markdown is canonical;
  `docs/*.html` files are regenerable human views.
- The **Priorities** section is user-set. Don't reorder it.

## Priorities (user-set)

1. **As simple a setup as possible** — one command per host, one command on
   the user's machine. Roadmap and verified current friction:
   `docs/installation-simplicity.md`.
2. **Codex support working** end-to-end (host auth durability is the
   remaining weak point).
3. **File uploading** to a project — push an arbitrary file to the VM
   without shelling in.

## P1 — do next

### Setup simplicity (priority 1)

- [ ] **Host install script** — `scripts/install-host.sh`, runnable as
  `curl … | bash`: Node ≥20 check/install, `npm i -g @cloudcli-ai/cloudcli`,
  IPv6-only detection baking `HOST=::` into the service env, systemd user
  unit (+ linger) on Linux / launchd agent on macOS, optional `--codex`
  writing `cli_auth_credentials_store = "file"` to `~/.codex/config.toml`,
  idempotent so re-running = update. Prints the final host URL. Details and
  open questions: `docs/installation-simplicity.md` (server side).
- [ ] **macOS signing + notarization** — get an Apple Developer ID and set
  the `APPLE_*` repo secrets; `release.yml` already activates signing when
  they're non-empty. Kills the Gatekeeper/quarantine dance, making the brew
  one-liner actually one step. Details: `docs/installation-simplicity.md`.
- [ ] **Cask auto-bump** — job in `.github/workflows/release.yml` (after
  asset upload) that computes the dmg sha256 and pushes `version`/`sha256`
  to `pfedotovsky/homebrew-tap` `Casks/agents-hub.rb` via a PAT.

### Codex (priority 2)

- [ ] **Durable Codex auth-status fix** — stop depending on the local
  CloudCLI patch that every `npm update -g` wipes (issue #13 in
  `docs/cloudcli-server-issues.md`). Host-side fix without forking CloudCLI:
  the install script's `--codex` flag (file credential store). Until the
  script exists, document the config.toml one-liner in the READMEs.
- [ ] **Codex parity audit in the hub** — drive a live Codex host and file
  concrete follow-ups: token-usage chip coverage, tool-call rendering edge
  cases beyond the v0.1.4 fixes, model/effort catalog freshness.

### File upload (priority 3)

- [ ] **File upload to a project** — drag-drop / attach button in the files
  side panel (`FileBrowser`). First sub-task is an API investigation against
  a live host: `PUT` file can write content but not create directories;
  images have `POST /api/assets/images`; the shell WS may be the escape
  hatch for binaries/dirs. Decide transport, then build the UI.

### Other API-ready items (carried from feature-parity)

- [ ] **Project management** — create, rename, delete/archive + restore,
  git-clone with `/clone-progress` stream. Full REST routes exist.
- [ ] **Session rename** — verify `PUT /api/providers/sessions/:id` against
  a live host; implement if stable.
- [ ] **Git panel: history & discard** — commit history, discard/revert
  (the rest of the git panel shipped 2026-07-12).

## P2 — high value, more work

- [ ] **Integrated terminal** — xterm.js against the host's shell WebSocket
  (node-pty PTY, resize, agent CLI or plain shell). Biggest single UX gap.
- [ ] **URL routing / deep links** — hash- or path-based routes for
  host/project/session; back-button support; prerequisite for PWA.
- [ ] **Mobile/responsive layout + PWA** — collapsible sidebar, manifest,
  service worker.
- [ ] **Web Push notifications** — subscribe to each host's VAPID push
  (`/api/settings/push/*`) so alerts arrive with the tab closed.
- [ ] **Token usage / context display** — per-session usage where
  `supportsTokenUsage` (claude/codex/opencode); codex already shows a
  context chip from `token_budget` frames — extend to claude.
- [ ] **Tauri auto-updater** — updater keypair, sign bundles in CI, publish
  `latest.json`; do after macOS signing. Details:
  `docs/installation-simplicity.md`.
- [ ] **Linux install one-liner** — document the stable
  `releases/latest/download/<asset>` URL or add a small install script
  choosing AppImage vs deb/rpm.

## P3 — nice to have

- [ ] **MCP server management UI** — per-provider + global over
  `/:provider/mcp/servers`.
- [ ] **Light theme / appearance settings** — currently hardcoded dark.
- [ ] **KaTeX + Mermaid rendering** in markdown messages.
- [ ] **Voice input** — mic capture → host `/api/voice` transcription proxy
  (needs host-side OpenAI key).
- [ ] **Skills management UI** — list/add/delete per provider.
- [ ] **TaskMaster integration** — task list + PRD tooling per project.
- [ ] **Conversation compaction control** (`compact`), if exposed over WS.
- [ ] **Windows build** — add `windows-latest` to the release matrix when a
  Windows user exists.

## Explicitly out of scope

Plugin system/marketplace, browser-use automation, Electron build,
API-key/credential admin, onboarding/git-identity setup — host-local
features or ones requiring a backend the hub deliberately doesn't have.
Also: forking or patching CloudCLI (hard constraint, see AGENTS.md).

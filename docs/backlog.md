# Backlog

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

- [ ] **Agent-CLI bootstrap + auth banner** — the host still needs `claude` /
  `codex` installed and logged in (interactive, per provider). `install.sh`
  should detect what's missing and print exact next steps; the hub should
  turn the "not signed in" state (issues #13/#15 already surface it
  server-side) into a first-class actionable banner instead of a silent
  empty chat.
- [ ] **Keep hosts current** — self-update was stripped from the fork; today
  it's a manual `brew upgrade fleet-server`. Add a cheap "update available"
  check (compare `/health` version against the latest `server-v*` release)
  surfaced in the hub, or an opt-in periodic upgrade, so a fleet doesn't
  drift.
- [ ] **Remote reachability helper** — the hardest part for remote VMs is
  networking (firewall, TLS, tunnel/VPN). The fleet-server bind default is now
  IPv6-first, so the remaining work is a documented one-liner tunnel and/or a
  hub-side "paste this on the VM" snippet. Details:
  `docs/installation-simplicity.md`.
- [ ] **macOS signing + notarization** — get an Apple Developer ID and set
  the `APPLE_*` repo secrets; `release.yml` already activates signing when
  they're non-empty. Kills the Gatekeeper/quarantine dance, making the brew
  one-liner actually one step. Details: `docs/installation-simplicity.md`.
- [ ] **Cask auto-bump** — job in `.github/workflows/release.yml` (after
  asset upload) that computes the dmg sha256 and pushes `version`/`sha256`
  to `pfedotovsky/homebrew-tap` `Casks/agents-hub.rb` via a PAT.

### Codex (priority 2)

- [x] **Durable Codex auth-status fix** — fixed at the source in
  fleet-server (`[fork-fix #13]`, `codex login status` fallback); ships with
  the first fleet-server release. Hosts still on stock CloudCLI keep needing
  the config.toml one-liner (file credential store).
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
  git-clone with `/clone-progress` stream. Full REST routes exist server-side
  but the hub client (`fleet-hub/src/lib/api.ts`) calls none of them yet.
  Includes **create or open a folder and start a session in it**: create a new
  directory (or pick/clone one) on the host, then hand the resulting
  `projectPath` straight to `createSession` so the user lands in a fresh chat.
  Pairs with the new-session folder picker below.
- [ ] **Start a session without pre-selecting a folder** — a global "New
  session" entry (from the feed / top level, not just inside a project) where
  the target folder is chosen inside the new-session UI. Today both entry
  points require an already-resolved project (`App.newSession` at
  `fleet-hub/src/App.tsx:133`; `ProjectPane.startNewSession` at
  `fleet-hub/src/components/ProjectPane.tsx:88`), and creation is deferred to
  first send in `ChatPane.send` (`ChatPane.tsx:1116`). Add a folder picker to
  the draft-chat composer that sets `projectPath` before the first
  `createSession` call; reuse the project list from `useFleet`
  (`fleet-hub/src/hooks/useFleet.ts`, `getProjects`) and, once available, the
  create/open-folder flow from Project management above.
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

## fleet-server (the CloudCLI server fork, added 2026-07-12)

The fork ships in `fleet-server/` with issues #1/#2/#4/#5/#6/#13/#14/#15
fixed at the source (see `fleet-server/README.md` divergence table).
Remaining work:

- [x] **First release** — `server-v0.1.0` shipped 2026-07-12; workflow
  green (typecheck+test+3-target build), 6 assets published,
  `install.sh` verified end-to-end, `brew install pfedotovsky/tap/fleet-server`
  verified (formula published to `pfedotovsky/homebrew-tap`).
- [ ] **Migrate the real hosts** from patched CloudCLI to fleet-server
  (side-by-side on :3011, then retire :3001) and drop the hand-patch notes
  from memory/docs. **Needs the host inventory / SSH access — user to
  direct which VMs and when.**
- [x] **Live hub verification against fleet-server** — verified 2026-07-12:
  fleet-hub dev added the host, logged in (Bun.password against a fresh
  register), and rendered 42 recency-ordered projects + a mixed
  Claude/Codex session feed with resolved titles, deep links, and live
  timestamps. Plus API/WS level: full Claude turn streamed, shell PTY
  (Bun.Terminal) echoed, chat.subscribe ack, fix #6 (mkdir on PUT), fix
  #13 (codex login status → authenticated), session_settings persisted.
  Not yet driven purely through the UI: opening a transcript inline, a
  live send with an interactive permission card, git panel, and search
  (the hub frontend is unchanged and already exercised against CloudCLI;
  every server endpoint they call is confirmed working).
- [ ] **Integrated terminal in the hub** — fleet-server kept the `/shell`
  PTY WebSocket (now Bun.Terminal-backed); the hub has no terminal UI yet.
- [ ] **Upstream sync cadence** — periodically diff new CloudCLI releases
  per `fleet-server/UPSTREAM.md` and cherry-pick relevant fixes.

## Explicitly out of scope

Plugin system/marketplace, browser-use automation, Electron build,
API-key/credential admin, onboarding/git-identity setup — host-local
features or ones requiring a backend the hub deliberately doesn't have.
(The former "no forking CloudCLI" constraint was dropped 2026-07-12 —
the fork lives in `fleet-server/`.)

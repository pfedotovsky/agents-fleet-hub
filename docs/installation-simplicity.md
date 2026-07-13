# Installation simplicity — current state and roadmap

Work-item status is tracked in `docs/backlog.md` (Priorities → item 1); this
document holds the detailed analysis behind those items.

Requirement (see AGENTS.md → Product principles): installing both parts must
be as simple as possible — **one command per host** for the server and
**one command on the user's machine** for Agents Hub.

> **Superseded for the server side (2026-07-12 evening):** the CloudCLI
> analysis below led to forking the server. **fleet-server**
> (`../fleet-server/`) is now the intended host install: one `curl | sh` (or
> brew formula), a single compiled binary, **no Node.js/npm on the host**,
> data in `~/.fleet-server` with automatic adoption of an existing
> `~/.cloudcli/auth.db`, port 3011 for side-by-side migration, and IPv6-first
> binding by default (`HOST=::`, with runtime fallback to `0.0.0.0` if IPv6 is
> unavailable). The Codex auth/version hand-patches described below are fixed
> in the fork itself.
> The sections below remain accurate for hosts still on stock CloudCLI.

Written 2026-07-12 after auditing the actual install paths. Facts below are
verified against CloudCLI 1.36.1, Agents Hub v0.1.4, `release.yml`, and the
homebrew-tap cask.

## Server side (CloudCLI on each host)

### What it takes today

1. Node.js 20+ must already be on the host (manual, distro-dependent).
2. `npm install -g @cloudcli-ai/cloudcli`
3. Launch: `cloudcli` — except IPv6-only VMs, which silently bind nothing
   useful unless launched as `HOST=:: cloudcli`.
4. Keep it alive: nothing does. The process dies with the SSH session unless
   the user hand-rolls tmux/nohup/systemd. Hibernated VMs need a manual
   relaunch after every wake.
5. Account creation: **already zero-step** — the hub offers first-time setup
   on first connect (`POST /api/auth/register`). Keep it that way.
6. Codex hosts only: Codex CLI ≥0.144 keychain auth isn't detected by
   CloudCLI's status endpoint (issue #13 in `cloudcli-server-issues.md`).
   Host-side fix is either `cli_auth_credentials_store = "file"` in
   `~/.codex/config.toml` or a local server patch that is **wiped by every
   cloudcli update**.
7. Updates: manual `npm update -g @cloudcli-ai/cloudcli` per host (and
   re-apply the codex patch after, if used).

So the honest step count is 4–7 manual actions per host, two of which
(HOST=::, keep-alive) are easy to get wrong and only fail later.

### What "one command per host" requires

A **host install script in this repo** (e.g. `scripts/install-host.sh`,
served so it can be run as `curl -fsSL <raw-url> | bash`). It wraps CloudCLI
without forking or patching it (respects the hard constraint):

- Check Node ≥20; if missing, install it (Linux: distro package or fnm/nvm —
  pick one and stick to it; macOS: brew).
- `npm install -g @cloudcli-ai/cloudcli`.
- Detect IPv6-only (no global IPv4 route) and bake `HOST=::` into the service
  environment instead of relying on the user to remember it.
- Install a supervisor so it survives logout and reboot:
  - Linux: a **systemd user unit** (`~/.config/systemd/user/cloudcli.service`
    + `loginctl enable-linger`) — no root needed;
  - macOS: a launchd agent plist.
- Optionally (`--codex` flag or auto-detect `~/.codex`): write
  `cli_auth_credentials_store = "file"` into `~/.codex/config.toml` so the
  auth-status endpoint tells the truth without patching CloudCLI.
- Idempotent, so re-running it is also the update path
  (`npm update -g` + service restart). A systemd timer for auto-update is
  possible but risky while we depend on hand-patches surviving updates —
  defer.
- Print the final URL (`http://<host>:3001`) so the user can paste it
  straight into the hub's settings.

Open questions before building it: which Linux distros to support first
(current fleet is what matters), and whether the script should also open the
firewall port (probably not — surprising side effect; print a hint instead).

## Client side (Agents Hub)

### What it takes today

- macOS: `brew install --cask pfedotovsky/tap/agents-hub` — already one
  command, **but** the app is unsigned, so Gatekeeper blocks first launch and
  the user needs `xattr -dr com.apple.quarantine` (Homebrew 6 dropped the
  `--no-quarantine` CLI flag; only the env var works). This is the single
  biggest friction point on the client side.
- Linux: manual download of AppImage/deb/rpm from the releases page — no
  package channel, no stable "latest" URL documented.
- Windows: not built at all (release matrix is macOS + ubuntu only).
- Updates: no in-app updater; macOS users re-run brew (after a manual cask
  bump — see below), Linux users re-download.

### What "one command" requires

Ranked by friction removed per unit of effort:

1. **Sign + notarize the macOS build.** Needs an Apple Developer ID
   ($99/yr). `release.yml` is already wired: setting the `APPLE_*` secrets
   turns signing/notarization on automatically (the workflow guards against
   the set-but-empty-secret failure mode). This deletes the quarantine
   dance entirely — the brew one-liner then just works.
2. **Automate the cask bump.** Today every release needs a manual
   `version`/`sha256` edit in homebrew-tap `Casks/agents-hub.rb`. Add a
   job to `release.yml` (after assets upload) that computes the sha and
   pushes the bump to the tap via a PAT with access to
   `pfedotovsky/homebrew-tap`. Removes the step where users
   `brew upgrade` and silently get the old version.
3. **In-app auto-update** via Tauri's updater plugin: generate an updater
   keypair, sign bundles in CI, publish `latest.json` with the release.
   Turns all future installs into zero-command updates on macOS *and*
   Linux (AppImage). Do after 1, since the updater artifacts should be
   signed builds.
4. **Linux one-liner.** Cheapest version: document a stable
   `releases/latest/download/<asset>` URL, or add a small install script
   that picks AppImage vs deb/rpm. A real apt/copr repo is not worth it at
   current scale.
5. **Windows build** — add `windows-latest` to the release matrix if/when a
   Windows user exists. Tauri supports it; cost is mostly CI time and an
   NSIS/MSI artifact nobody may need yet.

### First-run experience (already good, protect it)

Add host by URL → hub offers account creation on a fresh CloudCLI → sign in
once, JWT slides forward via `X-Refreshed-Token`. No config files, no
tokens to copy. Any future feature that requires per-host manual setup
(e.g. the deep-link limitation, issue #7) should be treated as a bug against
the simplicity requirement, not documented away.

## Suggested order of work

1. Host install script with systemd/launchd supervision and IPv6 detection
   (biggest server-side win; pure addition to this repo).
2. Apple Developer ID + secrets (biggest client-side win; zero code).
3. Cask auto-bump job in `release.yml`.
4. Tauri updater.
5. Linux install one-liner; Windows build on demand.

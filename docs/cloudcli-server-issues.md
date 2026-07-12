# CloudCLI server issues

Catalog of server-side defects and limitations in CloudCLI (upstream:
[siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)) that affect
Agents Hub. Purpose: input for the **fork vs. keep-working-around** decision.

Verified against CloudCLI 1.36.1 (source at
`/opt/homebrew/lib/node_modules/@cloudcli-ai/cloudcli/` + live testing),
2026-07-11.

Severity legend: 🔴 data loss / core feature broken · 🟡 degrades UX, has a
workaround · ⚪ annoyance / cosmetic.

| # | Issue | Severity | Client-side workaround? | Upstream status |
| --- | --- | --- | --- | --- |
| 1 | U+2028 in a message permanently orphans the session | 🔴 | No — needs manual data surgery | [#1002](https://github.com/siteboon/claudecodeui/issues/1002) (ours, open) |
| 2 | Session indexing is unrecoverable after any one-time failure | 🔴 | No | Part of #1002 |
| 3 | No multi-host support | 🔴 | Yes — Agents Hub *is* the workaround | [#187](https://github.com/siteboon/claudecodeui/issues/187) stalled |
| 4 | Nothing persisted per session: permission mode, allowed tools rebuilt from each `chat.send` | 🟡 | Yes — hub persists + re-sends | Not reported |
| 5 | `rememberEntry` ("always allow") lasts only the in-flight query | 🟡 | Yes — hub re-sends as `toolsSettings.allowedTools` | Not reported |
| 6 | `PUT /file` cannot create parent directories | 🟡 | Partial — grant write-through degrades to hub-only when `.claude/` is missing | Not reported |
| 7 | No URL-token handoff → hub login cannot authenticate the host's own UI | 🟡 | No — deep links require prior manual login on the host origin | Not reported |
| 8 | `messageCount` hardcoded to 0 | ⚪ | Yes — never displayed | Not reported |
| 9 | Projects returned unordered | ⚪ | Yes — recency derived from `sessions[0].lastActivity` | Not reported |
| 10 | 403 for *bad* JWT vs 401 for missing (non-standard) | ⚪ | Yes — both mapped to `AuthError` | Not reported |
| 11 | Mixed timestamp formats in the sessions DB | ⚪ | N/A (server-internal) | Not reported |
| 12 | Cursor-IDE sessions have no `store.db` → no transcripts/deep links | ⚪ | Yes — warning badge + hide toggle | Upstream/Cursor limitation |
| 13 | Codex keychain auth not detected — "not signed in" despite working login | 🟡 | No — host-side only (config or server patch) | [#1008](https://github.com/siteboon/claudecodeui/issues/1008) (ours, open) |

## 🔴 Blockers — cannot be fixed from the client

### 1. U+2028 in a message permanently orphans the session

[siteboon/claudecodeui#1002](https://github.com/siteboon/claudecodeui/issues/1002)
(reported by us, 2026-07-11, after losing a real session).

The session synchronizer (`server/shared/utils.ts` →
`extractFirstValidJsonlData`) reads transcript JSONL with Node `readline`,
which splits lines on U+2028/U+2029. Those characters are **legal unescaped in
JSON strings** and Claude Code writes them raw into transcripts (they commonly
arrive via pasted text). One such character truncates the line mid-string,
`JSON.parse` throws, and the `try/catch` wraps the whole read loop — the
entire file is skipped, not just the line.

Effect: the session row never gets `jsonl_path`, so
`GET /api/providers/sessions/:id/messages` returns an empty transcript, no
title is ever set ("Untitled session"), and `lastActivity` freezes. The
conversation looks deleted although the JSONL on disk is complete.

Recovery is manual only: escape raw `E2 80 A8` bytes to the six ASCII chars
`\u2028` in the JSONL, rewind `scan_state.last_scanned_at` in
`~/.cloudcli/auth.db` to before the file's creation time, `GET /api/projects`.

### 2. Session indexing is unrecoverable after any one-time failure

Two compounding design choices in the same subsystem (also written up in
#1002):

- **Incremental scans filter by file *birthtime*** against a single global
  cursor (`scan_state.last_scanned_at`). A file skipped once — parse failure,
  or scanned in the moment a brand-new transcript contains only
  `queue-operation` lines (no `cwd` yet) — is **never scanned again**, because
  its creation time is now behind the cursor. Modifications don't matter;
  `mtime` is never consulted.
- **The chokidar watcher can't compensate.** It fires `synchronizeFile` on
  changes, but hits the same deterministic parse failure each time
  (`indexed: false`), and in our live debugging it did not react at all to a
  pure `touch` (mtime-only change) — reliability unclear.

Net effect: the indexer has no retry path whatsoever. Any transient or
content-dependent failure translates into a permanently invisible session.

### 3. No multi-host support

[siteboon/claudecodeui#187](https://github.com/siteboon/claudecodeui/issues/187)
— stalled. Each CloudCLI instance is a single-host, single-user island. This
is the founding reason Agents Hub exists; a fork could instead make the server
itself aggregate hosts, but that is a large divergence from upstream.

## 🟡 Design limitations — worked around in Agents Hub, at a cost

### 4–5. No per-session persistence of chat options

The server rebuilds SDK options from `chat.send` payload on **every message**:
permission mode, allowed/disallowed tools — nothing is stored per session.
`rememberEntry` on `chat.permission-response` pushes a rule into in-memory
`allowedTools` **for the current query only**. Every client (the hub, the
stock UI, anything else) must maintain its own persistence and re-send
settings on every send. Cost in the hub: `fleethub.v1.permissions` /
`fleethub.v1.permissionModes` in localStorage plus re-send logic in
`ChatPane`; grants made in one client are invisible to others unless written
through to `.claude/settings.local.json`.

### 6. `PUT /api/projects/:id/file` cannot create parent directories

Write-through of "Always allow" grants to the host project's
`.claude/settings.local.json` fails when `.claude/` doesn't exist; the hub
degrades to localStorage-only grants and shows a banner. A server-side fix is
one `mkdir -p`.

### 7. No auth handoff into the host's own UI

CloudCLI's frontend keeps its JWT in its own origin's localStorage
(`auth-token`) and accepts no token via URL. The hub can never deep-link a
user into an authenticated host UI; users must have logged into each host
page manually at least once. Fork fix would be trivial (accept `?token=` on
the frontend — the API middleware already accepts it server-side).

### 13. Codex keychain auth not detected

[siteboon/claudecodeui#1008](https://github.com/siteboon/claudecodeui/issues/1008)
(reported by us, 2026-07-12, with the fix sketched; PR offered).

Codex CLI ≥0.144 stores login credentials in the OS keychain by default
(macOS: item "Codex Auth"); `~/.codex/auth.json` is never written. CloudCLI's
auth check (`server/modules/providers/list/codex/codex-auth.provider.ts` →
`checkCredentials`) reads **only** `auth.json`, so
`GET /api/providers/codex/auth/status` returns `authenticated: false` after a
perfectly successful `codex login`, and the hub shows "Codex is not signed in
on this host".

Verified 2026-07-12 (Codex CLI 0.144.1, CloudCLI 1.36.1):

- **Chat sessions are unaffected** — `@openai/codex-sdk` spawns a codex
  binary, and the keychain item's ACL matches OpenAI's code signature, so any
  codex binary (even the SDK's vendored 0.141.0) reads it silently. Only the
  status endpoint lies.
- Reading the keychain item from Node/`security` directly triggers a macOS
  GUI permission dialog — not viable for a headless server. The correct
  fallback is shelling out to `codex login status` (exit 0 = logged in).
- Host-side workarounds (the patch is applied on the dev machine):
  a ~15-line local patch to the installed `codex-auth.provider.js` adding the
  `codex login status` fallback — **wiped by every cloudcli update** — or
  `cli_auth_credentials_store = "file"` in `~/.codex/config.toml` plus a
  re-login, which makes codex write `auth.json` again.

No client-side workaround is possible: the hub can only relay what the status
endpoint reports, and suppressing the banner would also hide genuinely
logged-out hosts.

## ⚪ Annoyances — cheap to live with

- **8.** Session `messageCount` is hardcoded to `0` in list responses.
- **9.** `GET /api/projects` returns projects in no particular order;
  clients must derive recency themselves.
- **10.** Bad JWT → 403, missing JWT → 401; clients must treat both as
  auth failure.
- **11.** `sessions.updated_at` mixes SQLite `YYYY-MM-DD HH:MM:SS` (from
  `CURRENT_TIMESTAMP` writes, e.g. `assignProviderSessionId`) and ISO 8601
  strings (from disk-sync writes). Queries paper over it with `datetime()`,
  but it made debugging issue #1 notably harder and is a latent sorting bug
  for any query that compares the strings directly.
- **12.** Cursor-IDE-created sessions have no `store.db`, so transcripts and
  deep links fail for them.

## Fork decision — considerations, not a verdict

**What a fork buys:**
- Fixes for #1/#2 (the only 🔴 items that threaten data visibility) are
  small and local: split JSONL on `\n` only, per-line error handling,
  mtime-aware rescans. These cannot be worked around from the client.
- One-line fixes for #6 and #7.
- Optionally per-session option persistence (#4–5), removing the hub's most
  fragile re-send logic.
- A durable home for the #13 fix — today it lives as a hand-patch inside the
  globally-installed npm package and dies on every `npm update`. This is the
  first issue where "keep working around" means *re-applying a patch after
  every upstream release*, which is fork-shaped maintenance without fork
  benefits.

**What a fork costs:**
- Upstream moves fast (1.36.x); we take on merge burden for the whole server.
- The npm package is how VMs install it (`--registry=https://registry.npmjs.org`);
  a fork means our own distribution channel for every host.
- Everything in 🟡/⚪ is already handled in Agents Hub — the incremental win
  there is small.

**Middle grounds worth considering before a full fork:**
- Wait on #1002 — the fix is small enough that upstream may just take it, or
  submit it as a PR ourselves (fix without fork).
- A host-side "sanitizer" cron that escapes U+2028/U+2029 in fresh transcripts
  would neutralize issue #1 without touching CloudCLI (ugly but zero fork
  cost).

## Changelog

- 2026-07-11 — created after debugging a lost "Untitled session"
  (root-caused to issues #1 + #2; filed
  [#1002](https://github.com/siteboon/claudecodeui/issues/1002)).
- 2026-07-12 — added #13 (Codex keychain auth not detected) after `codex
  login` on a Codex CLI 0.144.1 host kept showing "not signed in"; patched
  locally and filed
  [#1008](https://github.com/siteboon/claudecodeui/issues/1008).

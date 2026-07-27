# Terminal proxy vs. structured UI

Investigation + working prototype. Question raised 2026-07-27: instead of the
custom structured chat UI, should the hub just **proxy a terminal session** —
run the agent CLI in a real PTY and stream it to the browser?

Status: **exploratory prototype in the working tree, not merged.** This file
captures the analysis and the prototype so the decision (adopt / discard) does
not have to re-derive it.

## The key finding

The terminal-proxy path is **not hypothetical here** — fleet-server already
ships it and the hub simply doesn't consume it:

- `fleet-server/server/modules/websocket/services/shell-websocket.service.ts`
  is a full PTY-over-WebSocket handler on the `/shell` route. On `init` it
  `pty.spawn`s a real shell (`bash -c` / `powershell`) running the agent CLI —
  e.g. `claude --resume "<id>" || claude`, `codex resume "<id>" || codex`,
  `cursor-agent --resume=…`, `opencode --session …` — streams `xterm-256color`
  output with ANSI intact, and supports `input` / `resize` plus reconnect
  buffering (5000 chunks, 30-min PTY retention keyed by `projectPath_sessionId`).
- Auth is the same as `/ws`: `verifyClient` runs on the upgrade, so
  `/shell?token=…` uses the ordinary host JWT.
- Before this prototype the hub had **no** consumer of `/shell` — no xterm.js,
  no `node-pty`. It drives the CLIs through their structured SDKs instead
  (`@anthropic-ai/claude-agent-sdk` `query()`, `@openai/codex-sdk`
  `runStreamed`), rendering normalized JSON (diffs, per-tool cards,
  `canUseTool` permission prompts, token budget). See `docs/architecture.md`.

`docs/feature-parity.md` already lists "Integrated terminal / shell" as the one
capability stock CloudCLI has (✅) that the hub does not (❌).

## Trade-off

**Terminal proxy — pros**
- Tiny surface, near-zero maintenance: xterm.js + the existing `/shell` WS
  replaces thousands of lines of renderers.
- Zero drift: whatever the CLI TUI does (new tools, slash commands, models) you
  get for free — no chasing SDK schema or the codex-cli version breakage tracked
  in `docs/cloudcli-server-issues.md` (#14/#15).
- Full fidelity: exactly what a local user sees, including interactive-only bits
  the SDK path hides (sessions tagged `sdk-ts` are invisible to
  `claude --resume`; empty-turn invisibility).
- Works for any CLI, SDK or not.

**Terminal proxy — cons**
- Kills the product differentiator: a terminal is one session, one host,
  keyboard-driven. The value prop is the cross-host merged feed / dashboard,
  which N live TUIs can't be.
- No structured data → no diffs, git panel, file browser, persisted
  "always allow" grants, token chip, transcript search.
- Bad on mobile/touch (fixed-width, hardware keyboard).
- Ephemeral & un-linkable (raw scrollback, not history paging / seq replay).
- Larger security surface (`bash -c` over a WS ≈ remote shell) and TTY/ANSI
  fragility.
- Wrong input model: buttons/dropdowns become raw keystrokes.

## Recommendation

**Hybrid, not replacement.** The structured hub *is* the product (multi-host
aggregation, diffs, permissions, search) — a terminal can't be that. But the
terminal is cheap and closes the one parity gap, so add it as a **secondary
per-session "Terminal" view** (escape hatch) over the already-existing `/shell`
WS. Primary = structured hub for the 90% flow; terminal = drop-to-raw for the
cases the SDK path handles poorly (empty turns, interactive slash commands,
unsupported tool types, any CLI without an SDK).

## The prototype (uncommitted)

Frontend only — no server changes; it consumes the `/shell` WS that already
exists.

- `fleet-hub/src/lib/shellSocket.ts` — `ShellSocket`, a reconnecting WS client
  for `/shell?token=…` mirroring `ChatSocket` (`init` / `input` / `resize`;
  `forceRestart` for the restart button so a transient drop reattaches to the
  live PTY instead of killing the CLI).
- `fleet-hub/src/components/TerminalPanel.tsx` — xterm.js + `@xterm/addon-fit`,
  resumes the open session's CLI, fixed dark theme, restart/close, auth-URL
  banner. Docks in the same right-hand slot as Files/Git.
- Wiring: `ChatPanelKind` gains `'terminal'` (`storage.ts`), a header toggle in
  `ChatPane.tsx`, and the panel render in `App.tsx`.
- Deps: `@xterm/xterm`, `@xterm/addon-fit`.

Because it reuses the Files/Git panel slot, it inherits their behaviour: not the
multi-terminal grid a real "fleet of terminals" would need — deliberately, since
the recommendation is escape-hatch, not primary surface.

### Verified
- `npm run build` (tsc + vite) and `npm run lint` clean.
- Drove `/shell` directly over a WS: plain-shell command streamed, `input` /
  `resize` exercised, and the real `claude` TUI launched and streamed.
- Real browser against the live local fleet-server (auto-authed localhost via
  `POST /api/auth/local-token`): opened a session → Terminal toggle → the
  `claude --resume` TUI rendered live beside the structured chat.

### Known rough edges (if adopted)
1. **Auth-URL false positive.** The `/shell` handler's auth-URL heuristic
   (`emitAuthUrl` in `shell-websocket.service.ts`) fires on *any* URL in the
   stream, so resuming a transcript that contains links surfaces a spurious
   "Login URL" banner. Suppress the banner for resumed sessions, or only honour
   `auth_url` during a fresh login flow.
2. **Light theme.** The terminal is intentionally fixed-dark (raw ANSI is tuned
   for a dark background and washes out on white). Fine as a decision; revisit
   if the hub's light theme should extend here.

## If adopted, update

- `docs/architecture.md` — add the hub's `/shell` PTY consumer to the module
  layout + data flow (currently only the SDK chat path is documented).
- `docs/feature-parity.md` (+ regenerate `feature-parity.html`) — flip
  "Integrated terminal / shell" for the hub.
- `docs/changelog.md` — record it as a shipped feature (this file currently logs
  it only as an exploration).

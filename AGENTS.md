# AGENTS.md

Guidance for coding agents working in this workspace.

## What this is

`agents-remote-control` is a workspace for remotely controlling coding agents
(Claude Code and others) running on remote hosts. Two projects:

- **`fleet-hub/`** — a static React SPA that aggregates projects, sessions,
  and live agent chat across several hosts (remote VMs + localhost). There is
  no backend: the browser talks to each host's REST API and `/ws` chat
  WebSocket directly.
- **`fleet-server/`** — the server that runs on each host: our fork of the
  CloudCLI UI server (upstream siteboon/claudecodeui 1.36.1), trimmed to the
  hub's API surface + a `/shell` PTY, ported to Bun, shipped as a single
  compiled binary. Licensed AGPL-3.0-or-later (unlike the rest of the repo) —
  see `fleet-server/LICENSE`, `NOTICE`, and `UPSTREAM.md` (provenance +
  upstream cherry-pick procedure). Hosts may alternatively still run stock
  CloudCLI; the hub supports both.

Read `docs/architecture.md` before touching `fleet-hub/src` — it documents the
module layout, data flow, and the verified CloudCLI 1.36.1 API contracts
(several of which are non-obvious: 403 = auth failure, `messageCount` always
0, unordered projects, etc.). fleet-server preserves those contracts except
where `docs/cloudcli-server-issues.md` marks an issue as fixed in the fork.

## Commands

From `fleet-hub/`:

```bash
npm run dev       # Vite dev server, http://localhost:5173
npm run build     # tsc -b && vite build  (this is the typecheck too)
npm run lint      # oxlint
npm run preview   # serve the production build
```

The hub has no tests. Verification = `npm run build` + `npm run lint` +
driving the UI against a live host.

From `fleet-server/` (requires Bun, not Node):

```bash
bun install
bun run dev        # start interpreted, port 3011
bun run typecheck  # tsc --noEmit
bun test server    # the test suite
bun run build      # compiled binary for this platform → dist/
```

## Conventions

- TypeScript, React 19 function components, hooks only — no classes except
  `ChatSocket` (`src/lib/chatSocket.ts`), which wraps a reconnecting WebSocket.
- Styling is Tailwind CSS v4 utility classes inline in JSX; dark zinc palette.
  No CSS modules, no styled-components.
- All CloudCLI HTTP calls go through `src/lib/api.ts` (`fetchJson` handles
  timeouts, `X-Refreshed-Token` capture, and 401/403 → `AuthError`). Do not
  call `fetch` directly from components.
- All localStorage access goes through `src/lib/storage.ts` (keys are
  namespaced `fleethub.v1.*`).
- Icons: `lucide-react`. Markdown: `react-markdown` + `remark-gfm`.
- Comments follow the existing style: only for non-obvious constraints and
  API quirks, not narration.

## Product principles

- **Installation of both parts must stay as simple as possible.** The target
  is: one command per host for the server (fleet-server single binary), one
  command on the user's machine for Agents Hub. When making changes, never add a manual
  install/setup step if it can be automated, defaulted, or handled by the hub
  at first run (the way first-connect account creation already is). Anything
  that unavoidably adds friction (a new prerequisite, a manual post-install
  command) must be flagged to the user and documented in the READMEs.
  Current state and the roadmap to get there: `docs/installation-simplicity.md`.

## Hard constraints

- **fleet-server is AGPL-3.0-or-later; the rest of the repo is not.** Never
  move code between `fleet-server/` and other directories. Keep the Section 7
  attribution ("CloudCLI UI (https://github.com/siteboon/claudecodeui)") and
  the NOTICE file intact; mark substantial changes to vendored files with a
  `Modified from CloudCLI 1.36.1 — see NOTICE` header; prefix upstream-defect
  fixes with `[fork-fix #N]` (numbering from `docs/cloudcli-server-issues.md`).
- **Don't hand-patch globally-installed CloudCLI** on hosts anymore — fix it
  in `fleet-server/` instead. (The old "no fork" constraint was dropped
  2026-07-12 when fleet-server was created.)
- A host's JWT allows running code as the user on that machine — never log
  tokens, never send them anywhere except the host they belong to, never
  persist passwords (only the JWT goes to localStorage).
- IPv6-only VMs need the server launched with `HOST=::`.
  Never `pkill -f cloudcli` or `pkill -f fleet-server` from an agent shell.

## Backlog

`docs/backlog.md` is the single source of truth for planned work:

- Before starting feature work, check it; if the work matches an item, do
  that item (and read its pointers first).
- When an item ships, delete it from `backlog.md` and record it in
  `docs/changelog.md`.
- Discovered gaps, ideas, and follow-ups → add them to `backlog.md` with
  pointers. Don't create new planning docs (and never HTML ones).
- The "Priorities" section at the top is user-set — don't reorder it.
- Markdown is canonical everywhere in `docs/`; `docs/*.html` files are
  regenerable human views (e.g. `feature-parity.html` mirrors
  `feature-parity.md`) and must be kept in sync or regenerated when their
  markdown source changes.

## Documentation upkeep

After a substantive change (feature, behavior change, fix — not pure
formatting), before finishing:

1. Add an entry to `docs/changelog.md` under the current date.
2. If module layout, data flow, or CloudCLI API usage changed, update
   `docs/architecture.md`.
3. If user-visible behavior changed, check `fleet-hub/README.md` still tells
   the truth.

Also, whenever you discover something important that isn't obvious from the
code — a verified CloudCLI API quirk, a design decision and its rationale, a
constraint you had to work around, results of an investigation — write it
down in `docs/` before finishing:

- CloudCLI API behavior and architecture details → `docs/architecture.md`
  (extend the relevant section).
- Findings that don't fit architecture (research notes, comparisons,
  investigation results) → a dedicated markdown file in `docs/` with a
  descriptive name (like the existing `docs/feature-parity.md`), and mention
  it in the changelog.

Rule of thumb: if rediscovering the fact would cost another agent real time,
it belongs in `docs/`, not just in the conversation.

A Stop hook will remind you about this; the source of truth is this list.

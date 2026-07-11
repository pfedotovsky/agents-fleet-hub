# AGENTS.md

Guidance for coding agents working in this workspace.

## What this is

`agents-remote-control` is a workspace for remotely controlling coding agents
(Claude Code and others) running on CloudCLI hosts. The only project right now
is **`fleet-hub/`** — a static React SPA that aggregates projects, sessions,
and live agent chat across several CloudCLI instances (remote VMs +
localhost). There is no backend: the browser talks to each host's CloudCLI
REST API and `/ws` chat WebSocket directly.

Read `docs/architecture.md` before touching `fleet-hub/src` — it documents the
module layout, data flow, and the verified CloudCLI 1.36.1 API contracts
(several of which are non-obvious: 403 = auth failure, `messageCount` always
0, unordered projects, etc.).

## Commands

All commands run from `fleet-hub/`:

```bash
npm run dev       # Vite dev server, http://localhost:5173
npm run build     # tsc -b && vite build  (this is the typecheck too)
npm run lint      # oxlint
npm run preview   # serve the production build
```

There are no tests. Verification = `npm run build` + `npm run lint` + driving
the UI against a live CloudCLI host.

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

## Hard constraints

- **Do NOT fork or patch CloudCLI.** Work around its API instead (upstream
  multi-host issue siteboon/claudecodeui#187 is stalled).
- A host's JWT allows running code as the user on that machine — never log
  tokens, never send them anywhere except the host they belong to, never
  persist passwords (only the JWT goes to localStorage).
- IPv6-only VMs need CloudCLI launched with `HOST=:: cloudcli`.
  Never `pkill -f cloudcli` from an agent shell.

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

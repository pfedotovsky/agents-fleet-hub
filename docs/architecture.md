# Fleet Hub — Architecture

Last verified: 2026-07-11 (CloudCLI 1.36.1).

## Overview

Fleet Hub is a **static React SPA with no backend**. The browser talks
directly to each configured CloudCLI host:

- REST (`/api/...`) with a Bearer JWT — projects, sessions, transcripts,
  files, models.
- One WebSocket per open chat (`/ws?token=JWT`) — live agent streaming,
  permission prompts, abort.

CloudCLI's CORS is wide open, which is what makes the no-backend design work.
All state that must survive a reload lives in the browser's localStorage.

```
Browser (Fleet Hub SPA)
  ├─ REST poll every 12 s ──► host A  (CodEnv VM, CloudCLI :3001)
  ├─ REST poll every 12 s ──► host B  (localhost:3001)
  └─ /ws?token=JWT ────────► whichever host owns the open chat
```

## Module map (`fleet-hub/src`)

| Module | Role |
| --- | --- |
| `App.tsx` | View router: a `View` union (`feed` / `project` / `files` / `chat`) in component state. No URL routing. |
| `hooks/useFleet.ts` | The heart of the app: host configs + prefs from storage, 12 s polling loop per host, host status machine, merged cross-host session feed, star toggle, login. |
| `lib/api.ts` | All REST calls. `fetchJson` adds timeout (AbortController), Bearer header, captures `X-Refreshed-Token`, maps 401/403 → `AuthError`, network failure → `HostUnreachableError`. |
| `lib/chatSocket.ts` | `ChatSocket` class — one reconnecting WS per chat (fixed 3 s retry until `close()`), typed senders: `chat.send` / `chat.subscribe` / `chat.abort` / `chat.permission-response`. |
| `lib/storage.ts` | localStorage wrapper, keys `fleethub.v1.{hosts,tokens,prefs,recentProjects,models}`. |
| `lib/format.ts` | Relative-time and path helpers. |
| `types.ts` | Shared types: `HostConfig/HostRuntime/HostStatus`, `Project`, `SessionSummary`, `FleetSession`, `ChatEvent`, `PermissionMode`, model catalog. |
| `components/Sidebar.tsx` | Hosts → projects tree: starred first, then recency; long tails behind "N more"; status dots. |
| `components/SessionList.tsx` + `SessionRow.tsx` | "All sessions" merged feed rows. |
| `components/ProjectPane.tsx` | One project: paged session list, "New session" (provider picker), Files button. |
| `components/ChatPane.tsx` | Largest component: history paging over REST + live WS chat, permission prompts, model/effort picker, permission mode, abort, `chat.subscribe` seq replay on reconnect. |
| `components/Messages.tsx`, `Markdown.tsx`, `ToolCall.tsx`, `Diff.tsx` | Transcript rendering: GFM markdown w/ syntax highlighting; per-tool renderers (Edit/Write = LCS diff, Bash = terminal line, TodoWrite = checklist, Read/Grep/Glob = one-liners). |
| `components/FileBrowser.tsx`, `FileTree.tsx`, `CodeEditor.tsx` | Project file tree + lazy-loaded CodeMirror editor (One Dark); Cmd+S saves via `PUT /file`. |
| `components/LoginModal.tsx`, `SettingsPanel.tsx`, `OfflineCard.tsx` | Per-host login (password never stored), host/prefs management, hibernated-VM card with restart hint. |

## Data flow

### Polling (`useFleet`)

- Every host is polled every **12 s** (`POLL_INTERVAL_MS`), staggered 300 ms
  at startup, plus on window focus and manual refresh.
- With a token: `GET /api/projects?sessionsLimit=5` → status `online` +
  projects. `AuthError` → drop token, `needs-auth`. Unreachable → `offline`.
- Without a token: `GET /api/auth/status` → `needs-setup` or `needs-auth`.
- In-flight guard per host: hibernating CodEnv VMs eat the full fetch timeout,
  so polls must not stack.
- When a host goes offline its last-known projects are kept so sessions stay
  visible, dimmed as stale.
- The feed = flatten all hosts' `projects[].sessions[]`, sort by
  `lastActivity` desc, cap at 120, optional `hideCursor` filter. Recency of a
  *project* is derived client-side from `sessions[0].lastActivity` — the API
  returns projects unordered.

### Chat (`ChatPane` + `ChatSocket`)

- History: `GET /api/providers/sessions/:id/messages?limit&offset` —
  `offset=0` is the **newest** page; offsets walk backward and count raw
  messages including `tool_result` kinds.
- Live: `chat.send {sessionId, content, options{permissionMode, model, effort}}`;
  the server streams the same normalized message kinds as history plus
  `complete{success}`, `permission_request{requestId,toolName,input}`,
  `chat_subscribed{isProcessing,pendingPermissions}`, `session_upserted`,
  `protocol_error{code}`.
- Reconnect: on every WS open the owner re-subscribes with
  `chat.subscribe {sessions:[{sessionId,lastSeq}]}` — the server replays
  missed events by sequence number.
- New session: `POST /api/providers/sessions {provider, projectPath}` creates
  an empty app session; the first `chat.send` actually starts the agent.
- Model catalog: `GET /api/providers/:provider/models` →
  `{OPTIONS:[{value,label,effort?}], DEFAULT}`; the chosen model+effort is
  stored per host and sent in `chat.send` options.

### Auth

- Login: `POST /api/auth/login {username,password}` → JWT. Only the JWT is
  stored (localStorage, per host); passwords never leave component state.
- Sliding refresh: any authenticated response may carry `X-Refreshed-Token`;
  `fetchJson` always captures it via a callback.
- **Both 401 and 403 mean auth failure** (CloudCLI returns 403 for a *bad*
  JWT, 401 for a missing one).

## Verified CloudCLI 1.36.1 quirks

Non-obvious facts this code depends on (verified from source + live):

- `GET /api/projects` returns a **bare array** (no envelope) and triggers a
  disk→DB session sync server-side — it can be slow.
- Session `messageCount` is hardcoded to 0 — never display it.
- Projects arrive unordered; sessions within a project are newest-first.
- Cursor-IDE-created sessions have no store.db → transcripts and deep links
  fail for them (hence the warning badge + hide toggle).
- File API: `GET .../files` = bare array tree, absolute paths,
  node_modules/.git pruned, depth 10; relative paths in `PUT .../file`
  resolve against the project root.
- Deep links into a host's own UI require having signed into that host's page
  once — its frontend keeps its JWT in *its own origin's* localStorage
  (`auth-token`) with no URL-token handoff, so the hub cannot authenticate it.
- CodEnv VMs are IPv6-only: CloudCLI must be launched with `HOST=:: cloudcli`.

## Security model

A host's JWT allows running arbitrary code as the user on that machine.
Tokens live only in the browser's localStorage of wherever the hub page is
served from — **do not host this page anywhere public**. `chat.permission-response`
approvals are real permission grants on the remote agent.

## Build / tooling

Vite 8 + `@vitejs/plugin-react`, TypeScript 6 (`tsc -b` runs as part of
`npm run build` and is the typecheck), Tailwind CSS v4 via `@tailwindcss/vite`,
oxlint for linting. No test framework is set up.

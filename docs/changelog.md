# Changelog

All notable changes to this workspace. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); newest entries first.
Agents: add an entry here after every substantive change (see AGENTS.md).

## 2026-07-11

### Added
- Initial Fleet Hub SPA (`fleet-hub/`): multi-host CloudCLI client — sidebar
  with hosts → projects (starred + recency ordering), merged cross-host
  session feed, project view with paged sessions and new-session creation
  (claude / codex / opencode), live chat over `/ws` (streaming, tool-call
  rendering, permission prompts, abort, model + effort picker, permission
  modes, seq-replay reconnect), per-project file browser with CodeMirror
  editor, per-host JWT auth with sliding refresh, offline cards for
  hibernated CodEnv VMs.
- Documentation set: `AGENTS.md`, `docs/architecture.md`, this changelog,
  plus a Stop hook that reminds agents to keep docs in sync.

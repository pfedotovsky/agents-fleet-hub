# Bun port notes (Phase 0 spike outcomes)

Verified 2026-07-12 with **Bun 1.3.14** on darwin-arm64. Spikes ran in a
scratch dir; results below are what the port relies on.

## Spike A — `bun build --compile` + PTY + claude-agent-sdk + ws

All three pass **inside a compiled single binary** (62 MB, `--minify`):

- **PTY: use `Bun.Terminal`, not node-pty.** node-pty is broken under Bun:
  1.1.0 fails with `posix_spawnp failed.` and 1.2.0-beta.14 hangs (onData /
  onExit callbacks never fire). Bun 1.3 ships a native PTY:
  `new Bun.Terminal({ cols, rows, data(term, chunk: Uint8Array) {...} })`
  passed to `Bun.spawn([...], { terminal })`; instance methods: `write`,
  `resize(cols, rows)`, `close`, `setRawMode`, flag accessors, `ref/unref`.
  Verified end-to-end: bash spawn, write, output capture, `resize` reflected
  in `stty size`, clean exit. **No native addon ships in the release at all**
  — `shared/pty-loader.ts` becomes a thin node-pty-shaped wrapper over
  `Bun.Terminal`.
- **`@anthropic-ai/claude-agent-sdk` 0.3.207**: a real one-turn `query()`
  works from the compiled binary with `pathToClaudeCodeExecutable` pointing
  at the host `claude`. No `process.execPath` re-exec issue observed.
- **`ws`**: `WebSocketServer({ noServer: true })` + manual `server.on('upgrade')`
  (upstream's exact pattern) works under Bun, including from the compiled
  binary.

## Spike B — SQLite

- Upstream's DB layer uses only: positional `?` params, `prepare().get/all/run`,
  `run()` meta (`changes`, `lastInsertRowid`), `db.exec` (incl. `PRAGMA`),
  `PRAGMA table_info(...)` via `prepare().all()`, and a single
  `db.transaction()` (`modules/database/repositories/sessions.db.ts:180`).
  No `.pluck/.raw/.iterate/db.pragma()`.
- **`bun:sqlite` covers all of it** — verified each pattern. The swap is a
  small adapter (`modules/database/sqlite-driver.ts`); better-sqlite3 is
  dropped from deps.

## bcrypt

`Bun.password.verify()` accepts node-bcrypt `$2b$` hashes (verified round-trip
both directions), and `Bun.password.hash(pw, { algorithm: 'bcrypt', cost: 12 })`
produces `$2b$` hashes. `routes/auth.js` can drop the native `bcrypt` dep;
existing users in a reused `~/.cloudcli/auth.db` keep working.

## Other notes

- node-pty prebuild coverage was the reason upstream pinned `1.2.0-beta.*`;
  irrelevant now (dep dropped).
- Session search (`session-conversations-search.service.ts`) shells out to
  `@vscode/ripgrep`'s bundled binary — a compiled build can't embed it, so
  resolve `rg` from PATH (dev fallback: the npm package) and degrade the SSE
  search stream gracefully when absent. `rg` is a recommended host dep in
  packaging.

// Modified from CloudCLI 1.36.1 — see NOTICE.
// better-sqlite3 replacement backed by bun:sqlite, so no native addon has to
// ship with the compiled binary. The DB layer only uses positional `?`
// binding, prepare().get/all/run (with run() meta), exec(), transaction(),
// and close() — all of which bun:sqlite provides with the same shapes
// (verified in docs/bun-port-notes.md). One behavioral difference: get()
// returns null instead of undefined for no-row results; callers here only do
// falsy checks, so both are equivalent.

import { Database as BunSqliteDatabase } from 'bun:sqlite';

export type Database = BunSqliteDatabase;

export default BunSqliteDatabase;

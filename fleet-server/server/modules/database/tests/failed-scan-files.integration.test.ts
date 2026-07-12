// [fork-fix #2] The failed-scan retry queue: files that fail to index are
// recorded, listed for retry until the attempt cap, and cleared on success.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import {
  failedScanFilesDb,
  MAX_SCAN_ATTEMPTS,
} from '@/modules/database/repositories/failed-scan-files.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'failed-scan-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('failed scans are retried until cleared by a successful index', async () => {
  await withIsolatedDatabase(() => {
    failedScanFilesDb.recordFailure('claude', '/tmp/a.jsonl', 'no session metadata extracted');
    failedScanFilesDb.recordFailure('claude', '/tmp/b.jsonl');
    failedScanFilesDb.recordFailure('codex', '/tmp/c.jsonl');

    assert.deepEqual(failedScanFilesDb.listRetryPaths('claude'), ['/tmp/a.jsonl', '/tmp/b.jsonl']);
    assert.deepEqual(failedScanFilesDb.listRetryPaths('codex'), ['/tmp/c.jsonl']);

    // Repeated failures bump attempts on the same row, not duplicate rows.
    failedScanFilesDb.recordFailure('claude', '/tmp/a.jsonl', 'still no metadata');
    assert.deepEqual(failedScanFilesDb.listRetryPaths('claude'), ['/tmp/a.jsonl', '/tmp/b.jsonl']);

    // Success removes the file from the queue.
    failedScanFilesDb.clearFailure('/tmp/a.jsonl');
    assert.deepEqual(failedScanFilesDb.listRetryPaths('claude'), ['/tmp/b.jsonl']);
  });
});

test('files stop being retried once the attempt cap is reached', async () => {
  await withIsolatedDatabase(() => {
    for (let attempt = 0; attempt < MAX_SCAN_ATTEMPTS; attempt += 1) {
      failedScanFilesDb.recordFailure('claude', '/tmp/hopeless.jsonl', 'parse failure');
    }

    assert.deepEqual(failedScanFilesDb.listRetryPaths('claude'), []);

    // A lower custom cap is respected, and the row itself still exists for diagnostics.
    assert.deepEqual(
      failedScanFilesDb.listRetryPaths('claude', MAX_SCAN_ATTEMPTS + 1),
      ['/tmp/hopeless.jsonl'],
    );
  });
});

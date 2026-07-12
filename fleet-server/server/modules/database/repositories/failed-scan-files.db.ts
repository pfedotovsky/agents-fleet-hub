// [fork-fix #2] Retry queue for transcript files that failed to index.
// Upstream compared file birthtime against a single global scan cursor, so a
// file that failed once (parse error, or a brand-new transcript with no
// session metadata in its first lines yet) fell behind the cursor and was
// never scanned again. Synchronizers record failures here and retry them on
// every full scan until they index or exhaust the attempt cap.

import { getConnection } from '@/modules/database/connection.js';

export const MAX_SCAN_ATTEMPTS = 20;

type FailedScanFileRow = {
  path: string;
  provider: string;
  attempts: number;
  last_error: string | null;
  last_attempt_at: string | null;
};

export const failedScanFilesDb = {
  recordFailure(provider: string, filePath: string, error?: string): void {
    const db = getConnection();
    db.prepare(
      `
      INSERT INTO failed_scan_files (path, provider, attempts, last_error, last_attempt_at)
      VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (path)
      DO UPDATE SET
        attempts = attempts + 1,
        last_error = excluded.last_error,
        last_attempt_at = excluded.last_attempt_at
      `
    ).run(filePath, provider, error ?? null);
  },

  clearFailure(filePath: string): void {
    const db = getConnection();
    db.prepare(`DELETE FROM failed_scan_files WHERE path = ?`).run(filePath);
  },

  /** Paths still worth retrying for a provider (attempt cap not reached). */
  listRetryPaths(provider: string, maxAttempts: number = MAX_SCAN_ATTEMPTS): string[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT path FROM failed_scan_files WHERE provider = ? AND attempts < ? ORDER BY path`
      )
      .all(provider, maxAttempts) as Array<Pick<FailedScanFileRow, 'path'>>;
    return rows.map((row) => row.path);
  },
};

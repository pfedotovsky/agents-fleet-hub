/**
 * Database connection management.
 *
 * Owns the single SQLite connection used across all repositories.
 * Handles path resolution, directory creation, legacy database migration,
 * and eager app_config bootstrap so the auth middleware can read the
 * JWT secret before the full schema is applied.
 *
 * Consumers should never create their own Database instance — they use
 * `getConnection()` to obtain the shared singleton.
 */

import Database, { type Database as DatabaseInstance } from '@/modules/database/sqlite-driver.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { APP_CONFIG_TABLE_SCHEMA_SQL } from '@/modules/database/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the database file path from environment or falls back
 * to the legacy location inside the server/database/ folder.
 *
 * Priority:
 *   1. DATABASE_PATH environment variable (set by cli.js or load-env-vars.js)
 *   2. Legacy path: server/database/auth.db
 */
function resolveDatabasePath(): string {
    // process.env.DATABASE_PATH is set by load-env-vars.js to either the .env value or a default(~/.cloudcli/auth.db) in the user's home directory. 
    return process.env.DATABASE_PATH || resolveLegacyDatabasePath();
}

/**
 * Resolves the legacy database path (always inside server/database/).
 * Used for the one-time migration to the new external location.
 */
function resolveLegacyDatabasePath(): string {
  const serverDir = path.resolve(__dirname, '..', '..', '..');
  return path.join(serverDir, 'database', 'auth.db');
}

// ---------------------------------------------------------------------------
// Directory & migration helpers
// ---------------------------------------------------------------------------

function ensureDatabaseDirectory(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('Created database directory:', dir);
  }
}

/**
 * If the database was moved to an external location
 * but the user still has a legacy auth.db inside the install directory,
 * copy it to the new location as a one-time migration.
 *
 * fleet-server addition: on first run, adopt an existing upstream CloudCLI
 * database (~/.cloudcli/auth.db) — same schema, so users, projects, and the
 * session index carry over. The original is copied, never touched, so
 * CloudCLI can keep running side by side.
 */
function migrateLegacyDatabase(targetPath: string): void {
  const fleetServerHome = process.env.FLEET_SERVER_HOME || path.join(os.homedir(), '.fleet-server');
  const defaultTargetPath = path.join(fleetServerHome, 'auth.db');
  const cloudcliPath = path.join(os.homedir(), '.cloudcli', 'auth.db');
  // Adopt the CloudCLI database only for the default data-dir location — an
  // explicitly customized DATABASE_PATH (tests, multi-instance setups) must
  // start from whatever that path holds, not inherit another server's data.
  const candidates =
    targetPath === defaultTargetPath
      ? [resolveLegacyDatabasePath(), cloudcliPath]
      : [resolveLegacyDatabasePath()];

  for (const legacyPath of candidates) {
    if (targetPath === legacyPath) continue;
    if (fs.existsSync(targetPath)) return;
    if (!fs.existsSync(legacyPath)) continue;

    try {
      fs.copyFileSync(legacyPath, targetPath);
      console.log('Migrated legacy database', { from: legacyPath, to: targetPath });

      // copy the write-ahead log and shared memory files (auth.db-wal, auth.db-shm) if they exist, to preserve any uncommitted transactions
      for (const suffix of ['-wal', '-shm']) {
        const src = legacyPath + suffix;
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, targetPath + suffix);
        }
      }
      return;
    } catch (err: any) {
      console.error('Could not migrate legacy database', { error: err.message });
    }
  }
}


// ---------------------------------------------------------------------------
// Singleton connection
// ---------------------------------------------------------------------------

let instance: DatabaseInstance | null = null;

/**
 * Returns the shared database connection, creating it on first call.
 *
 * The first invocation:
 *   1. Resolves the target database path
 *   2. Ensures the parent directory exists
 *   3. Migrates from the legacy install-directory path if needed
 *   4. Opens the SQLite connection
 *   5. Eagerly creates the app_config table (auth reads JWT secret at import time)
 *   6. Logs the database location
 */
export function getConnection(): DatabaseInstance {
  if (instance) return instance;

  const dbPath = resolveDatabasePath();

  ensureDatabaseDirectory(dbPath);
  migrateLegacyDatabase(dbPath);

  instance = new Database(dbPath);

  // app_config must exist immediately — the auth middleware reads
  // the JWT secret at module-load time, before initializeDatabase() runs.
  instance.exec(APP_CONFIG_TABLE_SCHEMA_SQL);

  return instance;
}

/**
 * Returns the resolved database file path without opening a connection.
 * Useful for diagnostics and CLI status commands.
 */
export function getDatabasePath(): string {
  return resolveDatabasePath();
}

/**
 * Closes the database connection and clears the singleton.
 * Primarily used for graceful shutdown or testing.
 */
export function closeConnection(): void {
  if (instance) {
    instance.close();
    instance = null;
    console.log('Database connection closed');
  }
}

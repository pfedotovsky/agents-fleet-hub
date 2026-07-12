// Modified from CloudCLI 1.36.1 — see NOTICE.
// Load environment variables from .env before other imports execute.
// fleet-server resolves .env from the data directory (~/.fleet-server by
// default) and the current working directory instead of upstream's npm
// package root, which does not exist for a compiled single-file binary.
import fs from 'fs';
import os from 'os';
import path from 'path';

export function getFleetServerHome() {
  return process.env.FLEET_SERVER_HOME || path.join(os.homedir(), '.fleet-server');
}

export function getDefaultDatabasePath() {
  return path.join(getFleetServerHome(), 'auth.db');
}

function loadEnvFile(envPath) {
  let envFile;
  try {
    envFile = fs.readFileSync(envPath, 'utf8');
  } catch {
    return; // .env files are optional
  }
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0 && !process.env[key]) {
        process.env[key] = valueParts.join('=').trim();
      }
    }
  });
}

// cwd first so an explicit local .env wins over the data-dir one.
loadEnvFile(path.join(process.cwd(), '.env'));
loadEnvFile(path.join(getFleetServerHome(), '.env'));

if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = getDefaultDatabasePath();
}

// Service managers start fleet-server with a minimal PATH (launchd:
// /usr/bin:/bin:/usr/sbin:/sbin — brew services' plist sets none), so the
// agent binaries the server spawns (claude in ~/.local/bin, codex/rg in the
// package-manager prefix) are invisible even though they work fine from the
// user's shell. Append the well-known install dirs; explicit *_CLI_PATH env
// vars and the user's existing PATH entries always take precedence.
if (process.platform !== 'win32') {
  const extraPathDirs = [
    path.join(os.homedir(), '.local', 'bin'), // claude native installer
    '/opt/homebrew/bin', // homebrew on Apple Silicon
    '/usr/local/bin', // homebrew on Intel, common manual installs
    path.join(os.homedir(), '.bun', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
  ];
  const pathParts = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of extraPathDirs) {
    if (!pathParts.includes(dir) && fs.existsSync(dir)) {
      pathParts.push(dir);
    }
  }
  process.env.PATH = pathParts.join(path.delimiter);
}

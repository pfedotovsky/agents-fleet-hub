// [fork-fix #14] Resolve the HOST's codex binary for @openai/codex-sdk.
// Upstream called `new Codex()` with no codexPathOverride, so the SDK always
// spawned the binary vendored inside the npm package. That binary lags the
// host install and OpenAI gates models on CLI version — a config.toml
// requesting a newer model got HTTP 400 and, in --experimental-json mode, a
// clean task_complete with no output (siteboon/claudecodeui#1011). Under a
// compiled single-file build the vendored binary is not even shipped, so
// host resolution is required, not an optimization.

import fs from 'node:fs';
import path from 'node:path';

let resolved: string | null | undefined;

function findOnPath(binary: string): string | null {
  const pathValue = process.env.PATH || '';
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, binary + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

/**
 * Returns the host codex binary path, or null when none is installed
 * (the SDK then falls back to its vendored binary — dev runs only).
 */
export function resolveCodexCliPath(): string | null {
  if (resolved !== undefined) return resolved;

  const override = process.env.CODEX_CLI_PATH;
  if (override && fs.existsSync(override)) {
    resolved = override;
    return resolved;
  }

  resolved = findOnPath('codex');
  if (!resolved) {
    console.warn(
      '[WARN] No codex binary found (checked CODEX_CLI_PATH and PATH). ' +
        'Codex chats will fail or use an outdated vendored CLI — install codex on this host.'
    );
  }
  return resolved;
}

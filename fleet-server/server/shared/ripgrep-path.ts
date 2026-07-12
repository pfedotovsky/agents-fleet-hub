// Modified from CloudCLI 1.36.1 — see NOTICE.
// Upstream imports rgPath from @vscode/ripgrep, whose bundled binary cannot
// ship inside a compiled single-file executable. Resolve ripgrep from the
// host instead: RG_PATH env → `rg` on PATH → the npm package (dev runs only).
// Returns null when unavailable; session search degrades gracefully.

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

export function resolveRipgrepPath(): string | null {
  if (resolved !== undefined) return resolved;

  if (process.env.RG_PATH && fs.existsSync(process.env.RG_PATH)) {
    resolved = process.env.RG_PATH;
    return resolved;
  }

  resolved = findOnPath('rg');
  if (resolved) return resolved;

  try {
    // Dynamic require so a compiled binary without the package still boots.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { rgPath } = require('@vscode/ripgrep') as { rgPath: string };
    if (fs.existsSync(rgPath)) {
      resolved = rgPath;
      return resolved;
    }
  } catch {
    // package not bundled — fall through
  }

  resolved = null;
  console.warn(
    '[WARN] ripgrep not found (checked RG_PATH, PATH, @vscode/ripgrep) — session search is disabled. Install it with e.g. `brew install ripgrep` or `apt install ripgrep`.'
  );
  return resolved;
}

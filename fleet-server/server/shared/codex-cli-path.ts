// [fork-fix #14/#18] Resolve the newest HOST codex binary for @openai/codex-sdk.
// Upstream called `new Codex()` with no codexPathOverride, so the SDK always
// spawned the binary vendored inside the npm package. That binary lags the
// host install and OpenAI gates models on CLI version — a config.toml
// requesting a newer model got HTTP 400 and, in --experimental-json mode, a
// clean task_complete with no output (siteboon/claudecodeui#1011). A second
// failure mode appears when the desktop app writes a newer shared model cache
// than an older PATH-installed CLI can parse. Under a compiled single-file
// build the SDK's vendored binary is not shipped, so host resolution is
// required, not an optimization.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

export type CodexCliVersion = readonly [major: number, minor: number, patch: number];

export function parseCodexCliVersion(output: string): CodexCliVersion | null {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(output);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: CodexCliVersion, right: CodexCliVersion): number {
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    if (delta !== 0) return delta;
  }
  return 0;
}

export function selectNewestCodexCliPath(
  candidates: readonly string[],
  readVersion: (candidate: string) => CodexCliVersion | null,
): string | null {
  let best: { path: string; version: CodexCliVersion | null } | null = null;

  for (const candidate of [...new Set(candidates)]) {
    const version = readVersion(candidate);
    if (!best || (version && (!best.version || compareVersions(version, best.version) > 0))) {
      best = { path: candidate, version };
    }
  }

  return best?.path ?? null;
}

function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function readCodexCliVersion(candidate: string): CodexCliVersion | null {
  const result = spawnSync(candidate, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  return parseCodexCliVersion(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}

function appBundledCandidates(): string[] {
  if (process.platform !== 'darwin') return [];

  const relative = path.join('Contents', 'Resources', 'codex');
  return [
    path.join('/Applications', 'ChatGPT.app', relative),
    path.join(os.homedir(), 'Applications', 'ChatGPT.app', relative),
    path.join('/Applications', 'Codex.app', relative),
    path.join(os.homedir(), 'Applications', 'Codex.app', relative),
  ];
}

/**
 * Returns the newest installed host Codex CLI path, or null when none is
 * installed (the SDK then falls back to its vendored binary — dev runs only).
 *
 * `CODEX_CLI_PATH` remains an explicit override and always wins. Otherwise we
 * compare PATH with the macOS desktop app's bundled CLI. Both share CODEX_HOME,
 * so choosing the newer binary prevents an older PATH install from crashing on
 * the model-cache schema most recently written by the desktop app.
 */
export function resolveCodexCliPath(): string | null {
  if (resolved !== undefined) return resolved;

  const override = process.env.CODEX_CLI_PATH;
  if (override && isExecutable(override)) {
    resolved = override;
    return resolved;
  }

  const pathCandidate = findOnPath('codex');
  const candidates = [pathCandidate, ...appBundledCandidates()]
    .filter((candidate): candidate is string => Boolean(candidate && isExecutable(candidate)));
  resolved = selectNewestCodexCliPath(candidates, readCodexCliVersion);
  if (!resolved) {
    console.warn(
      '[WARN] No codex binary found (checked CODEX_CLI_PATH, PATH, and desktop app installs). ' +
        'Codex chats will fail or use an outdated vendored CLI — install codex on this host.'
    );
  } else if (pathCandidate && resolved !== pathCandidate) {
    console.info(`[INFO] Using newer desktop-app Codex CLI: ${resolved}`);
  }
  return resolved;
}

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const installerPath = path.resolve(import.meta.dir, '../../../scripts/install.sh');

async function withFakePath(
  claudeStatus: number | null,
  codexStatus: number | null,
  run: (binDirectory: string) => void,
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fleet-agent-readiness-'));
  try {
    for (const [name, status] of [
      ['claude', claudeStatus],
      ['codex', codexStatus],
    ] as const) {
      if (status === null) continue;
      const executable = path.join(root, name);
      await writeFile(executable, `#!/bin/sh\necho SECRET_SENTINEL\nexit ${status}\n`);
      await chmod(executable, 0o755);
    }
    run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function checkAgents(binDirectory: string) {
  return spawnSync('/bin/sh', [installerPath, '--check-agents'], {
    encoding: 'utf8',
    env: {
      PATH: binDirectory,
      CLAUDE_CLI_PATH: '',
      CODEX_CLI_PATH: '',
    },
  });
}

test('installer diagnostics print exact provider install steps when CLIs are missing', async () => {
  await withFakePath(null, null, (binDirectory) => {
    const result = checkAgents(binDirectory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Claude Code: missing/);
    assert.match(result.stdout, /curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/);
    assert.match(result.stdout, /Codex: missing/);
    assert.match(result.stdout, /curl -fsSL https:\/\/chatgpt\.com\/codex\/install\.sh \| sh/);
  });
});

test('installer diagnostics distinguish signed-out CLIs without exposing auth output', async () => {
  await withFakePath(1, 1, (binDirectory) => {
    const result = checkAgents(binDirectory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Claude Code: installed, sign-in required/);
    assert.match(result.stdout, /Sign in: claude auth login/);
    assert.match(result.stdout, /Codex: installed, sign-in required/);
    assert.match(result.stdout, /Sign in: codex login/);
    assert.doesNotMatch(result.stdout, /SECRET_SENTINEL/);
  });
});

test('installer diagnostics report both authenticated CLIs as ready', async () => {
  await withFakePath(0, 0, (binDirectory) => {
    const result = checkAgents(binDirectory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Claude Code: ready \\(${binDirectory}/claude\\)`));
    assert.match(result.stdout, new RegExp(`Codex: ready \\(${binDirectory}/codex\\)`));
    assert.doesNotMatch(result.stdout, /SECRET_SENTINEL/);
  });
});

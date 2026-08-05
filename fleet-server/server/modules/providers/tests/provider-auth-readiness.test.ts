import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeProviderAuth } from '@/modules/providers/list/claude/claude-auth.provider.js';

test('claude auth reports a CLI that cannot start as not installed', async () => {
  const previousCliPath = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = path.join(
    os.tmpdir(),
    `fleet-server-missing-claude-cli-${randomUUID()}`,
  );

  try {
    const status = await new ClaudeProviderAuth().getStatus();

    assert.equal(status.installed, false);
    assert.equal(status.authenticated, false);
    assert.equal(status.error, 'Claude Code CLI is not installed');
  } finally {
    if (previousCliPath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = previousCliPath;
    }
  }
});

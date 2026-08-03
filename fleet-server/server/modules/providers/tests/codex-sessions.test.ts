import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'codex-provider-db-'));
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

/**
 * Writes one Codex rollout transcript. `firstUserMessage` mirrors the
 * `event_msg`/`user_message` payload the runtime records for the prompt the
 * user typed; omitting it produces a transcript with no user turn.
 */
const writeCodexTranscript = async (
  homeDir: string,
  codexSessionId: string,
  workspacePath: string,
  firstUserMessage?: string,
): Promise<string> => {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '07', '07');
  await mkdir(sessionsDir, { recursive: true });

  const lines: string[] = [
    JSON.stringify({ type: 'session_meta', payload: { id: codexSessionId, cwd: workspacePath } }),
  ];
  if (firstUserMessage !== undefined) {
    lines.push(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: firstUserMessage } }));
  }

  const filePath = path.join(sessionsDir, `rollout-${codexSessionId}.jsonl`);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
};

/**
 * Writes a Codex rollout with a plan-mode user turn (the server bakes
 * CODEX_PLAN_PREAMBLE into the persisted prompt) followed by an assistant
 * reply, then returns the file path. Timestamps are fixed so ids stay
 * deterministic across reads.
 */
const writePlanModeTranscript = async (
  homeDir: string,
  codexSessionId: string,
  workspacePath: string,
): Promise<string> => {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '07', '07');
  await mkdir(sessionsDir, { recursive: true });

  const preambledPrompt =
    '[PLAN MODE — READ ONLY]\nYou are operating in read-only planning mode.\n\n' +
    '--- USER REQUEST BELOW ---\n\nAdd a logout button';

  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { id: codexSessionId, cwd: workspacePath } }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-07-07T10:00:00.000Z',
      payload: { type: 'user_message', message: preambledPrompt },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-07-07T10:00:01.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Here is the plan.' }],
      },
    }),
  ];

  const filePath = path.join(sessionsDir, `rollout-${codexSessionId}.jsonl`);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
};

test('Codex history assigns stable ids across reads and strips the plan preamble', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-history-stable-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const jsonlPath = await writePlanModeTranscript(tempRoot, 'codex-hist-1', workspacePath);
    await withIsolatedDatabase(async () => {
      sessionsDb.createSession('codex-hist-1', 'codex', workspacePath, undefined, undefined, undefined, jsonlPath);

      const provider = new CodexSessionsProvider();
      const first = await provider.fetchHistory('codex-hist-1');
      const second = await provider.fetchHistory('codex-hist-1');

      // Same persisted messages must keep the same ids on every read — this is
      // what lets the hub de-duplicate instead of re-appending the transcript.
      assert.deepEqual(
        first.messages.map((m) => m.id),
        second.messages.map((m) => m.id),
      );
      assert.ok(first.messages.every((m) => m.id && !m.id.includes('undefined')));

      // The plan preamble the server prepended must not leak into the transcript.
      const userTurn = first.messages.find((m) => m.role === 'user');
      assert.ok(userTurn, 'expected a user turn');
      assert.equal(userTurn?.content, 'Add a logout button');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history reports latest context occupancy instead of cumulative thread usage', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-history-token-usage-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const jsonlPath = await writeCodexTranscript(tempRoot, 'codex-usage-1', workspacePath, 'Inspect usage');
    await writeFile(jsonlPath, `${[
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-usage-1', cwd: workspacePath } }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { total_tokens: 28466000 },
            last_token_usage: { total_tokens: 84200 },
            model_context_window: 258400,
          },
        },
      }),
    ].join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createSession('codex-usage-1', 'codex', workspacePath, undefined, undefined, undefined, jsonlPath);

      const history = await new CodexSessionsProvider().fetchHistory('codex-usage-1');

      assert.deepEqual(history.tokenUsage, { used: 84200, total: 258400 });
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history restores app-server web searches as native search rows', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-history-web-search-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const jsonlPath = await writeCodexTranscript(
      tempRoot,
      'codex-search-1',
      workspacePath,
      'Search official docs',
    );
    await writeFile(jsonlPath, `${[
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-search-1', cwd: workspacePath } }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T10:00:01.000Z',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'search-call-1',
          input: 'const r = await tools.web__run({search_query:[{q:"site:developers.openai.com/codex/ \\"Codex\\""}]}); text(r)',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T10:00:02.000Z',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'search-call-1',
          output: 'opaque external search result',
        },
      }),
    ].join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createSession('codex-search-1', 'codex', workspacePath, undefined, undefined, undefined, jsonlPath);

      const history = await new CodexSessionsProvider().fetchHistory('codex-search-1');
      const search = history.messages.find((message) => message.kind === 'tool_use');

      assert.equal(search?.toolName, 'WebSearch');
      assert.deepEqual(search?.toolInput, {
        query: 'site:developers.openai.com/codex/ "Codex"',
      });
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history restores app-server MCP wrappers as native tool rows', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-history-mcp-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const jsonlPath = await writeCodexTranscript(
      tempRoot,
      'codex-mcp-1',
      workspacePath,
      'Search official docs through MCP',
    );
    await writeFile(jsonlPath, `${[
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-mcp-1', cwd: workspacePath } }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T10:00:01.000Z',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'mcp-call-1',
          input: [
            'const result = await tools.mcp__openaiDeveloperDocs__search_openai_docs({',
            '  query: "Codex app server (official)",',
            '  limit: 5',
            '});',
            'text(result);',
          ].join('\n'),
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T10:00:02.000Z',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'mcp-call-1',
          output: 'opaque MCP result metadata',
        },
      }),
    ].join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createSession('codex-mcp-1', 'codex', workspacePath, undefined, undefined, undefined, jsonlPath);

      const history = await new CodexSessionsProvider().fetchHistory('codex-mcp-1');
      const tool = history.messages.find((message) => message.kind === 'tool_use');

      assert.equal(tool?.toolName, 'search_openai_docs');
      assert.equal(tool?.server, 'openaiDeveloperDocs');
      assert.equal(tool?.toolInput, '{\n  query: "Codex app server (official)",\n  limit: 5\n}');
      assert.equal(history.messages.some((message) => message.kind === 'tool_result'), false);
      assert.equal(JSON.stringify(history.messages).includes('opaque MCP result metadata'), false);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history restores collaboration function calls as Agent rows', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-history-collab-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const jsonlPath = await writeCodexTranscript(
      tempRoot,
      'codex-collab-1',
      workspacePath,
      'Delegate one bounded check',
    );
    await writeFile(jsonlPath, `${[
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-collab-1', cwd: workspacePath } }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T10:00:01.000Z',
        payload: {
          type: 'function_call',
          name: 'spawn_agent',
          call_id: 'collab-call-1',
          arguments: JSON.stringify({
            task_name: 'confirm',
            fork_turns: 'all',
            message: 'opaque-provider-prompt',
            model: 'gpt-5.6-terra',
            reasoning_effort: 'low',
          }),
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T10:00:02.000Z',
        payload: {
          type: 'function_call_output',
          call_id: 'collab-call-1',
          output: JSON.stringify({ task_name: '/root/confirm' }),
        },
      }),
    ].join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createSession('codex-collab-1', 'codex', workspacePath, undefined, undefined, undefined, jsonlPath);

      const history = await new CodexSessionsProvider().fetchHistory('codex-collab-1');
      const tool = history.messages.find((message) => message.kind === 'tool_use');

      assert.equal(tool?.toolName, 'Agent');
      assert.deepEqual(JSON.parse(String(tool?.toolInput)), {
        action: 'spawnAgent',
        taskName: 'confirm',
        forkTurns: 'all',
        target: null,
        timeoutMs: null,
        model: 'gpt-5.6-terra',
        reasoningEffort: 'low',
      });
      assert.ok(!JSON.stringify(tool).includes('opaque-provider-prompt'));
      assert.equal(tool?.toolResult?.content, JSON.stringify({ task_name: '/root/confirm' }));
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history restores image views without forwarding opaque output', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-history-image-view-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const jsonlPath = await writeCodexTranscript(
      tempRoot,
      'codex-image-view-1',
      workspacePath,
      'Inspect the icon',
    );
    await writeFile(jsonlPath, `${[
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-image-view-1', cwd: workspacePath } }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T10:00:01.000Z',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'image-call-1',
          input: 'const r = await tools.view_image({ path: "/workspace/project/icon.png" });\nimage(r.image_url);',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T10:00:02.000Z',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'image-call-1',
          output: 'opaque image payload',
        },
      }),
    ].join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createSession(
        'codex-image-view-1',
        'codex',
        workspacePath,
        undefined,
        undefined,
        undefined,
        jsonlPath,
      );

      const history = await new CodexSessionsProvider().fetchHistory('codex-image-view-1');
      const tool = history.messages.find((message) => message.kind === 'tool_use');

      assert.equal(tool?.toolName, 'ViewImage');
      assert.deepEqual(tool?.toolInput, {
        path: '/workspace/project/icon.png',
      });
      assert.equal(history.messages.some((message) => message.kind === 'tool_result'), false);
      assert.equal(JSON.stringify(history.messages).includes('opaque image payload'), false);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer titles app-created sessions from the first user message', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-app-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await writeCodexTranscript(tempRoot, 'codex-app-1', workspacePath, 'Fix the login redirect bug');
    await withIsolatedDatabase(async () => {
      // The app allocates its own id and later maps the provider id onto it,
      // exactly as a message sent from cloudcli does.
      sessionsDb.createAppSession('app-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-1', 'codex-app-1');

      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();

      assert.equal(sessionsDb.getSessionById('app-1')?.custom_name, 'Fix the login redirect bug');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer leaves indexed sessions untitled when no name is available', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-indexed-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // A CLI-created session has no app row; its first user message must NOT be
    // used as the title, preserving the existing indexing behavior.
    await writeCodexTranscript(tempRoot, 'codex-indexed-1', workspacePath, 'This prompt should be ignored');
    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();

      assert.equal(sessionsDb.getSessionById('codex-indexed-1')?.custom_name, 'Untitled Codex Session');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

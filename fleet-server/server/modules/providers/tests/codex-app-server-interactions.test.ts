import { describe, expect, test } from 'bun:test';

import { createCodexAppServerRequestHandler } from '@/modules/providers/list/codex/codex-app-server-interactions.js';
import {
  getPendingPermissionsForSession,
  resolvePendingPermission,
} from '@/shared/pending-permissions.js';

describe('Codex app-server interaction bridge', () => {
  test('maps command and file approvals onto Hub decisions', async () => {
    const events: unknown[] = [];
    const handler = createCodexAppServerRequestHandler({
      getProviderSessionId: () => 'thread-1',
      getTurnId: () => 'turn-1',
      signal: new AbortController().signal,
      onEvent: (event) => {
        events.push(event);
        if (event.type !== 'permission_request') return;
        resolvePendingPermission(event.requestId, event.toolName === 'Edit'
          ? { allow: false }
          : { allow: true, rememberEntry: 'Bash(git:*)' });
      },
    });

    expect(await handler({
      id: 10,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-command',
        command: 'git status',
        cwd: '/workspace',
        reason: 'Inspect the worktree',
      },
    })).toEqual({ decision: 'acceptForSession' });

    expect(await handler({
      id: 11,
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-file',
        reason: 'Apply the patch',
        grantRoot: '/workspace',
      },
    })).toEqual({ decision: 'decline' });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'permission_request',
        toolName: 'Bash',
        providerSessionId: 'thread-1',
        input: expect.objectContaining({ command: 'git status', cwd: '/workspace' }),
      }),
      expect.objectContaining({
        type: 'permission_request',
        toolName: 'Edit',
        providerSessionId: 'thread-1',
        input: expect.objectContaining({ itemId: 'item-file', grantRoot: '/workspace' }),
      }),
    ]);
    expect(getPendingPermissionsForSession('codex', 'thread-1')).toEqual([]);
  });

  test('converts non-secret option answers back to question ids', async () => {
    const handler = createCodexAppServerRequestHandler({
      getProviderSessionId: () => 'thread-question',
      getTurnId: () => 'turn-question',
      signal: new AbortController().signal,
      onEvent: (event) => {
        if (event.type === 'permission_request') {
          expect(event.toolName).toBe('AskUserQuestion');
          resolvePendingPermission(event.requestId, {
            allow: true,
            updatedInput: { answers: { 'Choose mode': 'Fast' } },
          });
        }
      },
    });

    expect(await handler({
      id: 'question-rpc',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-question',
        turnId: 'turn-question',
        itemId: 'item-question',
        autoResolutionMs: null,
        questions: [{
          id: 'mode',
          header: 'Mode',
          question: 'Choose mode',
          isOther: true,
          isSecret: false,
          options: [{ label: 'Fast', description: 'Fewer checks' }],
        }],
      },
    })).toEqual({ answers: { mode: { answers: ['Fast'] } } });
  });

  test('fails closed for secret questions and requests outside the active turn', async () => {
    const handler = createCodexAppServerRequestHandler({
      getProviderSessionId: () => 'thread-1',
      getTurnId: () => 'turn-1',
      signal: new AbortController().signal,
      onEvent: () => {},
    });

    await expect(handler({
      id: 12,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-secret',
        autoResolutionMs: null,
        questions: [{
          id: 'secret',
          header: 'Secret',
          question: 'Enter a token',
          isOther: true,
          isSecret: true,
          options: [],
        }],
      },
    })).rejects.toThrow('cannot be represented safely');

    await expect(handler({
      id: 13,
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'another-thread',
        turnId: 'turn-1',
        itemId: 'item-file',
      },
    })).rejects.toThrow('out-of-scope request');
  });
});

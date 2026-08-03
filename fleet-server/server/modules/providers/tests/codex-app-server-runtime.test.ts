import { describe, expect, test } from 'bun:test';

import {
  createCodexAppServerRuntime,
} from '@/modules/providers/list/codex/codex-app-server-runtime.js';
import type { CodexAppServerConversationEvent } from '@/modules/providers/list/codex/codex-app-server-conversation.js';
import type { NormalizedMessage } from '@/shared/types.js';

const effectiveSettings = {
  cwd: '/workspace/project',
  model: 'gpt-5.6-sol',
  approvalPolicy: 'untrusted',
  sandbox: { type: 'workspaceWrite' },
  reasoningEffort: 'high',
};

function createWriter(messages: NormalizedMessage[], sessionIds: string[]) {
  return {
    userId: 'user-1',
    send: (message: NormalizedMessage) => messages.push(message),
    setSessionId: (sessionId: string) => sessionIds.push(sessionId),
  };
}

describe('Codex app-server runtime', () => {
  test('maps conversation events onto the normalized chat protocol', async () => {
    const messages: NormalizedMessage[] = [];
    const sessionIds: string[] = [];
    const runtime = createCodexAppServerRuntime({
      resolveSelection: async (_sessionId, model) => {
        expect(model).toBeUndefined();
        return { model: 'gpt-5.6-sol', effort: 'high' };
      },
      runConversation: async (input, options) => {
        expect(input).toMatchObject({
          cwd: '/workspace/project',
          prompt: 'Do the work',
          model: 'gpt-5.6-sol',
          effort: 'high',
          permissionMode: 'default',
        });
        const emit = (event: CodexAppServerConversationEvent) => options?.onEvent?.(event);
        emit({
          type: 'session',
          providerSessionId: 'thread-1',
          effectiveSettings,
        });
        emit({
          type: 'command_execution',
          command: {
            id: 'command-1',
            command: "printf 'done\\n'",
            cwd: '/workspace/project',
            status: 'inProgress',
            commandActions: [{ type: 'unknown', command: 'printf' }],
            output: '',
            exitCode: null,
            durationMs: null,
          },
        });
        emit({
          type: 'command_execution',
          command: {
            id: 'command-1',
            command: "printf 'done\\n'",
            cwd: '/workspace/project',
            status: 'inProgress',
            commandActions: [{ type: 'unknown', command: 'printf' }],
            output: 'done\n',
            exitCode: null,
            durationMs: null,
          },
        });
        emit({
          type: 'command_execution',
          command: {
            id: 'command-1',
            command: "printf 'done\\n'",
            cwd: '/workspace/project',
            status: 'completed',
            commandActions: [{ type: 'unknown', command: 'printf' }],
            output: 'done\n',
            exitCode: 0,
            durationMs: 5,
          },
        });
        emit({ type: 'warning', message: 'Managed setting applied' });
        emit({
          type: 'permission_request',
          requestId: 'request-1',
          toolName: 'Bash',
          input: { command: 'pwd' },
          providerSessionId: 'thread-1',
        });
        emit({
          type: 'token_budget',
          tokenBudget: {
            used: 42,
            total: 1_000,
            inputTokens: 30,
            outputTokens: 12,
            breakdown: { input: 30, output: 12, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
          },
        });
        emit({ type: 'assistant_delta', itemId: 'item-1', delta: 'All ' });
        emit({ type: 'assistant_delta', itemId: 'item-1', delta: 'done.' });
        emit({
          type: 'permission_cancelled',
          requestId: 'request-1',
          reason: 'cancelled',
          providerSessionId: 'thread-1',
        });
        emit({ type: 'turn_complete', status: 'completed', error: null });
        return {
          providerSessionId: 'thread-1',
          turnId: 'turn-1',
          status: 'completed',
          error: null,
          emittedAssistantText: true,
          effectiveSettings,
        };
      },
      notifyRunStopped: () => {},
    });

    await runtime.query(
      'Do the work',
      { projectPath: '/workspace/project', permissionMode: 'default', model: 'default' },
      createWriter(messages, sessionIds),
    );

    expect(sessionIds).toEqual(['thread-1']);
    expect(messages.map((message) => message.kind)).toEqual([
      'status',
      'tool_use',
      'tool_use',
      'tool_use',
      'status',
      'permission_request',
      'status',
      'permission_cancelled',
      'text',
      'complete',
    ]);
    expect(messages[0]).toMatchObject({
      provider: 'codex',
      sessionId: 'thread-1',
      text: 'effective_settings',
    });
    expect(messages[3]).toMatchObject({
      id: 'codex_app_server_command-1',
      toolName: 'Bash',
      toolId: 'command-1',
      output: 'done\n',
      status: 'completed',
      exitCode: 0,
      durationMs: 5,
      toolInput: {
        command: "printf 'done\\n'",
        cwd: '/workspace/project',
      },
    });
    expect(messages[8]).toMatchObject({
      id: 'codex_app_server_item-1',
      role: 'assistant',
      content: 'All done.',
    });
    expect(messages[9]).toMatchObject({ exitCode: 0, actualSessionId: 'thread-1' });
    expect(runtime.isActive('thread-1')).toBeFalse();
  });

  test('aborts an active turn without emitting a duplicate terminal frame', async () => {
    const messages: NormalizedMessage[] = [];
    const sessionIds: string[] = [];
    let releaseConversation: (() => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    const runtime = createCodexAppServerRuntime({
      resolveSelection: async () => ({ model: undefined, effort: undefined }),
      runConversation: async (_input, options) => {
        observedSignal = options?.signal;
        options?.onEvent?.({
          type: 'session',
          providerSessionId: 'thread-abort',
          effectiveSettings,
        });
        await new Promise<void>((resolve) => {
          releaseConversation = resolve;
        });
        options?.onEvent?.({ type: 'turn_complete', status: 'interrupted', error: null });
        return {
          providerSessionId: 'thread-abort',
          turnId: 'turn-abort',
          status: 'interrupted',
          error: null,
          emittedAssistantText: false,
          effectiveSettings,
        };
      },
    });

    const query = runtime.query('Wait', {}, createWriter(messages, sessionIds));
    while (!runtime.isActive('thread-abort')) await Promise.resolve();

    expect(runtime.abort('thread-abort')).toBeTrue();
    expect(observedSignal?.aborted).toBeTrue();
    releaseConversation?.();
    await query;

    expect(messages.filter((message) => message.kind === 'complete')).toHaveLength(0);
    expect(runtime.isActive('thread-abort')).toBeFalse();
  });
});

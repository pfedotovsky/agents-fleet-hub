import { describe, expect, test } from 'bun:test';

import type {
  CodexAppServerClientOptions,
  CodexAppServerHandshake,
} from '@/modules/providers/list/codex/codex-app-server-client.js';
import {
  runCodexAppServerConversation,
  type CodexAppServerConversationEvent,
} from '@/modules/providers/list/codex/codex-app-server-conversation.js';

const handshake: CodexAppServerHandshake = {
  cliVersion: [0, 146, 0],
  protocolBaseline: '0.146',
  initialize: {
    userAgent: 'codex-app-server/0.146.0',
    codexHome: '/tmp/codex-home',
    platformFamily: 'unix',
    platformOs: 'macos',
  },
};

describe('Codex app-server conversation runner', () => {
  test('starts a thread and normalizes safe core turn events', async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const events: CodexAppServerConversationEvent[] = [];
    let clientOptions: CodexAppServerClientOptions | null = null;
    let stopped = false;

    const result = await runCodexAppServerConversation({
      cwd: '/workspace/project',
      prompt: 'Explain the change',
      model: 'gpt-5.6-sol',
      effort: 'high',
      permissionMode: 'plan',
      ephemeral: true,
    }, {
      createClient: (options) => {
        clientOptions = options;
        return {
          start: async () => handshake,
          request: async <Result>(method: string, params: unknown): Promise<Result> => {
            requests.push({ method, params });
            if (method === 'thread/start') {
              return {
                thread: { id: 'thread-1' },
                cwd: '/workspace/project',
                model: 'gpt-5.6-sol',
                approvalPolicy: 'on-request',
                sandbox: { type: 'readOnly', networkAccess: false },
                reasoningEffort: 'high',
              } as Result;
            }
            if (method === 'turn/start') {
              queueMicrotask(() => {
                options.onNotification?.({
                  method: 'configWarning',
                  params: { summary: 'Managed setting applied', details: 'Policy was constrained' },
                });
                options.onNotification?.({
                  method: 'item/agentMessage/delta',
                  params: {
                    threadId: 'thread-1',
                    turnId: 'turn-1',
                    itemId: 'item-1',
                    delta: 'Done',
                  },
                });
                options.onNotification?.({
                  method: 'thread/tokenUsage/updated',
                  params: {
                    threadId: 'thread-1',
                    turnId: 'turn-1',
                    tokenUsage: {
                      total: { totalTokens: 999 },
                      last: {
                        totalTokens: 120,
                        inputTokens: 90,
                        outputTokens: 30,
                        cachedInputTokens: 40,
                        cacheWriteInputTokens: 5,
                        reasoningOutputTokens: 12,
                      },
                      modelContextWindow: 258_400,
                    },
                  },
                });
                options.onNotification?.({
                  method: 'turn/completed',
                  params: {
                    threadId: 'thread-1',
                    turn: { id: 'turn-1', status: 'completed', error: null },
                  },
                });
              });
              return { turn: { id: 'turn-1' } } as Result;
            }
            throw new Error(`Unexpected method ${method}`);
          },
          stop: () => {
            stopped = true;
          },
        };
      },
      onEvent: (event) => events.push(event),
      turnTimeoutMs: 1_000,
    });

    expect(clientOptions).not.toBeNull();
    expect(requests).toEqual([
      {
        method: 'thread/start',
        params: {
          cwd: '/workspace/project',
          model: 'gpt-5.6-sol',
          approvalPolicy: 'never',
          sandbox: 'read-only',
          serviceName: 'agents_hub',
          ephemeral: true,
        },
      },
      {
        method: 'turn/start',
        params: {
          threadId: 'thread-1',
          input: [{ type: 'text', text: 'Explain the change', text_elements: [] }],
          cwd: '/workspace/project',
          model: 'gpt-5.6-sol',
          effort: 'high',
        },
      },
    ]);
    expect(events).toEqual([
      {
        type: 'session',
        providerSessionId: 'thread-1',
        effectiveSettings: {
          cwd: '/workspace/project',
          model: 'gpt-5.6-sol',
          approvalPolicy: 'on-request',
          sandbox: { type: 'readOnly', networkAccess: false },
          reasoningEffort: 'high',
        },
      },
      { type: 'warning', message: 'Managed setting applied: Policy was constrained' },
      { type: 'assistant_delta', itemId: 'item-1', delta: 'Done' },
      {
        type: 'token_budget',
        tokenBudget: {
          used: 120,
          total: 258_400,
          inputTokens: 90,
          outputTokens: 30,
          breakdown: {
            input: 90,
            output: 30,
            cacheRead: 40,
            cacheWrite: 5,
            reasoning: 12,
          },
        },
      },
      { type: 'turn_complete', status: 'completed', error: null },
    ]);
    expect(result).toEqual({
      providerSessionId: 'thread-1',
      turnId: 'turn-1',
      status: 'completed',
      error: null,
      emittedAssistantText: true,
      effectiveSettings: {
        cwd: '/workspace/project',
        model: 'gpt-5.6-sol',
        approvalPolicy: 'on-request',
        sandbox: { type: 'readOnly', networkAccess: false },
        reasoningEffort: 'high',
      },
    });
    expect(stopped).toBeTrue();
  });

  test('resumes by provider id and uses completed agent text when no delta arrived', async () => {
    const methods: string[] = [];
    const events: CodexAppServerConversationEvent[] = [];

    const result = await runCodexAppServerConversation({
      cwd: '/workspace/project',
      prompt: 'Continue',
      providerSessionId: 'thread-existing',
    }, {
      createClient: (options) => ({
        start: async () => handshake,
        request: async <Result>(method: string): Promise<Result> => {
          methods.push(method);
          if (method === 'thread/resume') {
            return {
              thread: { id: 'thread-existing' },
              cwd: '/workspace/project',
              model: 'gpt-5.6-sol',
              approvalPolicy: 'untrusted',
              sandbox: { type: 'workspaceWrite' },
              reasoningEffort: null,
            } as Result;
          }
          queueMicrotask(() => {
            options.onNotification?.({
              method: 'item/agentMessage/delta',
              params: {
                threadId: 'other-thread',
                turnId: 'turn-2',
                itemId: 'ignored',
                delta: 'Ignore me',
              },
            });
            options.onNotification?.({
              method: 'item/completed',
              params: {
                threadId: 'thread-existing',
                turnId: 'turn-2',
                item: { type: 'agentMessage', id: 'item-2', text: 'Fallback text' },
              },
            });
            options.onNotification?.({
              method: 'turn/completed',
              params: {
                threadId: 'thread-existing',
                turn: {
                  id: 'turn-2',
                  status: 'failed',
                  error: { message: 'Turn failed safely' },
                },
              },
            });
          });
          return { turn: { id: 'turn-2' } } as Result;
        },
        stop: () => {},
      }),
      onEvent: (event) => events.push(event),
      turnTimeoutMs: 1_000,
    });

    expect(methods).toEqual(['thread/resume', 'turn/start']);
    expect(events.filter((event) => event.type === 'assistant_delta')).toEqual([
      { type: 'assistant_delta', itemId: 'item-2', delta: 'Fallback text' },
    ]);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Turn failed safely');
  });

  test('stops the transport when a thread response is invalid', async () => {
    let stopped = false;
    await expect(runCodexAppServerConversation({
      cwd: '/workspace/project',
      prompt: 'Hello',
    }, {
      createClient: () => ({
        start: async () => handshake,
        request: async <Result>() => ({ thread: {} }) as Result,
        stop: () => {
          stopped = true;
        },
      }),
    })).rejects.toThrow('invalid thread response');
    expect(stopped).toBeTrue();
  });

  test('times out a silent turn and still stops the transport', async () => {
    let stopped = false;
    await expect(runCodexAppServerConversation({
      cwd: '/workspace/project',
      prompt: 'Hello',
    }, {
      createClient: () => ({
        start: async () => handshake,
        request: async <Result>(method: string) => (
          method === 'thread/start'
            ? {
                thread: { id: 'thread-silent' },
                cwd: '/workspace/project',
                model: 'gpt-5.6-sol',
                approvalPolicy: 'untrusted',
                sandbox: { type: 'workspaceWrite' },
                reasoningEffort: null,
              } as Result
            : { turn: { id: 'turn-silent' } } as Result
        ),
        stop: () => {
          stopped = true;
        },
      }),
      turnTimeoutMs: 5,
    })).rejects.toThrow('Timed out waiting for Codex app-server turn completion');
    expect(stopped).toBeTrue();
  });
});

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
    expect(typeof (clientOptions as CodexAppServerClientOptions | null)?.onServerRequest).toBe('function');
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
          summary: 'auto',
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

  test('streams readable reasoning summaries without exposing raw reasoning', async () => {
    const events: CodexAppServerConversationEvent[] = [];

    await runCodexAppServerConversation({
      cwd: '/workspace/project',
      prompt: 'Think through the change',
    }, {
      createClient: (options) => ({
        start: async () => handshake,
        request: async <Result>(method: string): Promise<Result> => {
          if (method === 'thread/start') {
            return {
              thread: { id: 'thread-reasoning' },
              cwd: '/workspace/project',
              model: 'gpt-5.6-sol',
              approvalPolicy: 'untrusted',
              sandbox: { type: 'workspaceWrite' },
              reasoningEffort: 'high',
            } as Result;
          }
          if (method === 'turn/start') {
            queueMicrotask(() => {
              options.onNotification?.({
                method: 'item/started',
                params: {
                  threadId: 'thread-reasoning',
                  turnId: 'turn-reasoning',
                  item: {
                    type: 'reasoning',
                    id: 'reasoning-1',
                    summary: [],
                    content: ['private started reasoning'],
                  },
                },
              });
              options.onNotification?.({
                method: 'item/reasoning/summaryTextDelta',
                params: {
                  threadId: 'thread-reasoning',
                  turnId: 'turn-reasoning',
                  itemId: 'reasoning-1',
                  delta: 'Reviewing ',
                  summaryIndex: 0,
                },
              });
              options.onNotification?.({
                method: 'item/reasoning/summaryTextDelta',
                params: {
                  threadId: 'thread-reasoning',
                  turnId: 'turn-reasoning',
                  itemId: 'reasoning-1',
                  delta: 'contracts',
                  summaryIndex: 0,
                },
              });
              options.onNotification?.({
                method: 'item/reasoning/summaryPartAdded',
                params: {
                  threadId: 'thread-reasoning',
                  turnId: 'turn-reasoning',
                  itemId: 'reasoning-1',
                  summaryIndex: 1,
                },
              });
              options.onNotification?.({
                method: 'item/reasoning/textDelta',
                params: {
                  threadId: 'thread-reasoning',
                  turnId: 'turn-reasoning',
                  itemId: 'reasoning-1',
                  delta: 'private raw reasoning',
                  contentIndex: 0,
                },
              });
              options.onNotification?.({
                method: 'item/reasoning/summaryTextDelta',
                params: {
                  threadId: 'thread-reasoning',
                  turnId: 'turn-reasoning',
                  itemId: 'reasoning-1',
                  delta: 'Choosing adapter',
                  summaryIndex: 1,
                },
              });
              options.onNotification?.({
                method: 'item/completed',
                params: {
                  threadId: 'thread-reasoning',
                  turnId: 'turn-reasoning',
                  item: {
                    type: 'reasoning',
                    id: 'reasoning-1',
                    summary: ['Reviewing contracts', 'Choosing adapter'],
                    content: ['private completed reasoning'],
                  },
                },
              });
              options.onNotification?.({
                method: 'turn/completed',
                params: {
                  threadId: 'thread-reasoning',
                  turn: { id: 'turn-reasoning', status: 'completed', error: null },
                },
              });
            });
            return { turn: { id: 'turn-reasoning' } } as Result;
          }
          throw new Error(`Unexpected method ${method}`);
        },
        stop: () => {},
      }),
      onEvent: (event) => events.push(event),
      turnTimeoutMs: 1_000,
    });

    expect(events.filter((event) => event.type === 'reasoning_summary')).toEqual([
      {
        type: 'reasoning_summary',
        reasoning: { id: 'reasoning-1', summary: 'Reviewing' },
      },
      {
        type: 'reasoning_summary',
        reasoning: { id: 'reasoning-1', summary: 'Reviewing contracts' },
      },
      {
        type: 'reasoning_summary',
        reasoning: {
          id: 'reasoning-1',
          summary: 'Reviewing contracts\n\nChoosing adapter',
        },
      },
      {
        type: 'reasoning_summary',
        reasoning: {
          id: 'reasoning-1',
          summary: 'Reviewing contracts\n\nChoosing adapter',
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('private');
  });

  test('normalizes web-search lifecycle without forwarding opaque results', async () => {
    const events: CodexAppServerConversationEvent[] = [];

    await runCodexAppServerConversation({
      cwd: '/workspace/project',
      prompt: 'Search official docs',
    }, {
      createClient: (options) => ({
        start: async () => handshake,
        request: async <Result>(method: string): Promise<Result> => {
          if (method === 'thread/start') {
            return {
              thread: { id: 'thread-search' },
              cwd: '/workspace/project',
              model: 'gpt-5.6-sol',
              approvalPolicy: 'untrusted',
              sandbox: { type: 'workspaceWrite' },
              reasoningEffort: null,
            } as Result;
          }
          if (method === 'turn/start') {
            queueMicrotask(() => {
              options.onNotification?.({
                method: 'item/started',
                params: {
                  threadId: 'thread-search',
                  turnId: 'turn-search',
                  item: {
                    type: 'webSearch',
                    id: 'search-1',
                    query: 'OpenAI Codex official docs',
                    action: null,
                    results: null,
                  },
                },
              });
              options.onNotification?.({
                method: 'item/completed',
                params: {
                  threadId: 'thread-search',
                  turnId: 'turn-search',
                  item: {
                    type: 'webSearch',
                    id: 'search-1',
                    query: 'OpenAI Codex official docs',
                    action: {
                      type: 'search',
                      query: 'OpenAI Codex official docs',
                      queries: ['OpenAI Codex official docs'],
                    },
                    results: [{ title: 'Untrusted external result body' }],
                  },
                },
              });
              options.onNotification?.({
                method: 'turn/completed',
                params: {
                  threadId: 'thread-search',
                  turn: { id: 'turn-search', status: 'completed', error: null },
                },
              });
            });
            return { turn: { id: 'turn-search' } } as Result;
          }
          throw new Error(`Unexpected method ${method}`);
        },
        stop: () => {},
      }),
      onEvent: (event) => events.push(event),
      turnTimeoutMs: 1_000,
    });

    expect(events.filter((event) => event.type === 'web_search')).toEqual([
      {
        type: 'web_search',
        webSearch: {
          id: 'search-1',
          query: 'OpenAI Codex official docs',
          action: null,
          status: 'inProgress',
        },
      },
      {
        type: 'web_search',
        webSearch: {
          id: 'search-1',
          query: 'OpenAI Codex official docs',
          action: {
            type: 'search',
            query: 'OpenAI Codex official docs',
            queries: ['OpenAI Codex official docs'],
          },
          status: 'completed',
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('Untrusted external result body');
  });

  test('normalizes MCP tool lifecycle and forwards only safe textual output', async () => {
    const events: CodexAppServerConversationEvent[] = [];

    await runCodexAppServerConversation({
      cwd: '/workspace/project',
      prompt: 'Search official docs through MCP',
    }, {
      createClient: (options) => ({
        start: async () => handshake,
        request: async <Result>(method: string): Promise<Result> => {
          if (method === 'thread/start') {
            return {
              thread: { id: 'thread-mcp' },
              cwd: '/workspace/project',
              model: 'gpt-5.6-sol',
              approvalPolicy: 'untrusted',
              sandbox: { type: 'workspaceWrite' },
              reasoningEffort: null,
            } as Result;
          }
          if (method === 'turn/start') {
            queueMicrotask(() => {
              options.onNotification?.({
                method: 'item/started',
                params: {
                  threadId: 'thread-mcp',
                  turnId: 'turn-mcp',
                  item: {
                    type: 'mcpToolCall',
                    id: 'mcp-1',
                    server: 'openaiDeveloperDocs',
                    tool: 'search_openai_docs',
                    status: 'inProgress',
                    arguments: { query: 'Codex app server' },
                    appContext: null,
                    pluginId: null,
                    result: null,
                    error: null,
                    durationMs: null,
                  },
                },
              });
              options.onNotification?.({
                method: 'item/mcpToolCall/progress',
                params: {
                  threadId: 'thread-mcp',
                  turnId: 'turn-mcp',
                  itemId: 'mcp-1',
                  message: 'Searching official documentation',
                },
              });
              options.onNotification?.({
                method: 'item/completed',
                params: {
                  threadId: 'thread-mcp',
                  turnId: 'turn-mcp',
                  item: {
                    type: 'mcpToolCall',
                    id: 'mcp-1',
                    server: 'openaiDeveloperDocs',
                    tool: 'search_openai_docs',
                    status: 'completed',
                    arguments: { query: 'Codex app server' },
                    appContext: null,
                    pluginId: null,
                    result: {
                      content: [
                        { type: 'text', text: 'Found the Codex app-server docs.' },
                        { type: 'image', data: 'opaque-image-data' },
                      ],
                      structuredContent: { opaque: 'structured-secret' },
                      _meta: { opaque: 'metadata-secret' },
                    },
                    error: null,
                    durationMs: 42,
                  },
                },
              });
              options.onNotification?.({
                method: 'turn/completed',
                params: {
                  threadId: 'thread-mcp',
                  turn: { id: 'turn-mcp', status: 'completed', error: null },
                },
              });
            });
            return { turn: { id: 'turn-mcp' } } as Result;
          }
          throw new Error(`Unexpected method ${method}`);
        },
        stop: () => {},
      }),
      onEvent: (event) => events.push(event),
      turnTimeoutMs: 1_000,
    });

    expect(events.filter((event) => event.type === 'mcp_tool_call')).toEqual([
      {
        type: 'mcp_tool_call',
        mcpToolCall: {
          id: 'mcp-1',
          server: 'openaiDeveloperDocs',
          tool: 'search_openai_docs',
          arguments: { query: 'Codex app server' },
          status: 'inProgress',
          output: '',
          error: null,
          durationMs: null,
        },
      },
      {
        type: 'mcp_tool_call',
        mcpToolCall: {
          id: 'mcp-1',
          server: 'openaiDeveloperDocs',
          tool: 'search_openai_docs',
          arguments: { query: 'Codex app server' },
          status: 'inProgress',
          output: 'Searching official documentation',
          error: null,
          durationMs: null,
        },
      },
      {
        type: 'mcp_tool_call',
        mcpToolCall: {
          id: 'mcp-1',
          server: 'openaiDeveloperDocs',
          tool: 'search_openai_docs',
          arguments: { query: 'Codex app server' },
          status: 'completed',
          output: 'Found the Codex app-server docs.',
          error: null,
          durationMs: 42,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('opaque-image-data');
    expect(JSON.stringify(events)).not.toContain('structured-secret');
    expect(JSON.stringify(events)).not.toContain('metadata-secret');
  });

  test('normalizes command lifecycle and accumulates ordered output deltas', async () => {
    const events: CodexAppServerConversationEvent[] = [];

    await runCodexAppServerConversation({
      cwd: '/workspace/project',
      prompt: 'Run printf',
    }, {
      createClient: (options) => ({
        start: async () => handshake,
        request: async <Result>(method: string): Promise<Result> => {
          if (method === 'thread/start') {
            return {
              thread: { id: 'thread-command' },
              cwd: '/workspace/project',
              model: 'gpt-5.6-sol',
              approvalPolicy: 'untrusted',
              sandbox: { type: 'workspaceWrite' },
              reasoningEffort: null,
            } as Result;
          }
          if (method === 'turn/start') {
            queueMicrotask(() => {
              options.onNotification?.({
                method: 'item/started',
                params: {
                  threadId: 'thread-command',
                  turnId: 'turn-command',
                  startedAtMs: 1,
                  item: {
                    type: 'commandExecution',
                    id: 'command-1',
                    command: "printf 'alpha\\nbeta\\n'",
                    cwd: '/workspace/project',
                    status: 'inProgress',
                    commandActions: [{ type: 'unknown', command: 'printf' }],
                    aggregatedOutput: null,
                    exitCode: null,
                    durationMs: null,
                  },
                },
              });
              options.onNotification?.({
                method: 'item/commandExecution/outputDelta',
                params: {
                  threadId: 'thread-command',
                  turnId: 'turn-command',
                  itemId: 'command-1',
                  delta: 'alpha\n',
                },
              });
              options.onNotification?.({
                method: 'item/commandExecution/outputDelta',
                params: {
                  threadId: 'thread-command',
                  turnId: 'turn-command',
                  itemId: 'command-1',
                  delta: 'beta\n',
                },
              });
              options.onNotification?.({
                method: 'item/completed',
                params: {
                  threadId: 'thread-command',
                  turnId: 'turn-command',
                  completedAtMs: 5,
                  item: {
                    type: 'commandExecution',
                    id: 'command-1',
                    command: "printf 'alpha\\nbeta\\n'",
                    cwd: '/workspace/project',
                    status: 'completed',
                    commandActions: [{ type: 'unknown', command: 'printf' }],
                    aggregatedOutput: null,
                    exitCode: 0,
                    durationMs: 4,
                  },
                },
              });
              options.onNotification?.({
                method: 'turn/completed',
                params: {
                  threadId: 'thread-command',
                  turn: { id: 'turn-command', status: 'completed', error: null },
                },
              });
            });
            return { turn: { id: 'turn-command' } } as Result;
          }
          throw new Error(`Unexpected method ${method}`);
        },
        stop: () => {},
      }),
      onEvent: (event) => events.push(event),
      turnTimeoutMs: 1_000,
    });

    expect(events.filter((event) => event.type === 'command_execution')).toEqual([
      {
        type: 'command_execution',
        command: {
          id: 'command-1',
          command: "printf 'alpha\\nbeta\\n'",
          cwd: '/workspace/project',
          status: 'inProgress',
          commandActions: [{ type: 'unknown', command: 'printf' }],
          output: '',
          exitCode: null,
          durationMs: null,
        },
      },
      expect.objectContaining({
        type: 'command_execution',
        command: expect.objectContaining({ output: 'alpha\n' }),
      }),
      expect.objectContaining({
        type: 'command_execution',
        command: expect.objectContaining({ output: 'alpha\nbeta\n' }),
      }),
      {
        type: 'command_execution',
        command: {
          id: 'command-1',
          command: "printf 'alpha\\nbeta\\n'",
          cwd: '/workspace/project',
          status: 'completed',
          commandActions: [{ type: 'unknown', command: 'printf' }],
          output: 'alpha\nbeta\n',
          exitCode: 0,
          durationMs: 4,
        },
      },
    ]);
  });

  test('normalizes file-change lifecycle and replaces patch updates', async () => {
    const events: CodexAppServerConversationEvent[] = [];
    const initialChanges = [{
      path: '/workspace/project/notes.txt',
      kind: { type: 'update' as const, move_path: null },
      diff: '@@ -1 +1 @@\n-old\n+draft',
    }];
    const finalChanges = [{
      path: '/workspace/project/notes.txt',
      kind: { type: 'update' as const, move_path: null },
      diff: '@@ -1 +1 @@\n-old\n+final',
    }];

    await runCodexAppServerConversation({
      cwd: '/workspace/project',
      prompt: 'Update notes',
    }, {
      createClient: (options) => ({
        start: async () => handshake,
        request: async <Result>(method: string): Promise<Result> => {
          if (method === 'thread/start') {
            return {
              thread: { id: 'thread-files' },
              cwd: '/workspace/project',
              model: 'gpt-5.6-sol',
              approvalPolicy: 'untrusted',
              sandbox: { type: 'workspaceWrite' },
              reasoningEffort: null,
            } as Result;
          }
          if (method === 'turn/start') {
            queueMicrotask(() => {
              options.onNotification?.({
                method: 'item/started',
                params: {
                  threadId: 'thread-files',
                  turnId: 'turn-files',
                  item: {
                    type: 'fileChange',
                    id: 'file-change-1',
                    changes: initialChanges,
                    status: 'inProgress',
                  },
                },
              });
              options.onNotification?.({
                method: 'item/fileChange/patchUpdated',
                params: {
                  threadId: 'thread-files',
                  turnId: 'turn-files',
                  itemId: 'file-change-1',
                  changes: finalChanges,
                },
              });
              options.onNotification?.({
                method: 'item/completed',
                params: {
                  threadId: 'thread-files',
                  turnId: 'turn-files',
                  item: {
                    type: 'fileChange',
                    id: 'file-change-1',
                    changes: finalChanges,
                    status: 'completed',
                  },
                },
              });
              options.onNotification?.({
                method: 'turn/completed',
                params: {
                  threadId: 'thread-files',
                  turn: { id: 'turn-files', status: 'completed', error: null },
                },
              });
            });
            return { turn: { id: 'turn-files' } } as Result;
          }
          throw new Error(`Unexpected method ${method}`);
        },
        stop: () => {},
      }),
      onEvent: (event) => events.push(event),
      turnTimeoutMs: 1_000,
    });

    expect(events.filter((event) => event.type === 'file_change')).toEqual([
      {
        type: 'file_change',
        fileChange: {
          id: 'file-change-1',
          changes: initialChanges,
          status: 'inProgress',
        },
      },
      {
        type: 'file_change',
        fileChange: {
          id: 'file-change-1',
          changes: finalChanges,
          status: 'inProgress',
        },
      },
      {
        type: 'file_change',
        fileChange: {
          id: 'file-change-1',
          changes: finalChanges,
          status: 'completed',
        },
      },
    ]);
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

  test('interrupts the active app-server turn when aborted', async () => {
    const controller = new AbortController();
    const requests: string[] = [];
    let stopped = false;

    const result = await runCodexAppServerConversation({
      cwd: '/workspace/project',
      prompt: 'Wait',
    }, {
      signal: controller.signal,
      createClient: (options) => ({
        start: async () => handshake,
        request: async <Result>(method: string): Promise<Result> => {
          requests.push(method);
          if (method === 'thread/start') {
            return {
              thread: { id: 'thread-abort' },
              cwd: '/workspace/project',
              model: 'gpt-5.6-sol',
              approvalPolicy: 'untrusted',
              sandbox: { type: 'workspaceWrite' },
              reasoningEffort: null,
            } as Result;
          }
          if (method === 'turn/start') {
            queueMicrotask(() => controller.abort());
            return { turn: { id: 'turn-abort' } } as Result;
          }
          if (method === 'turn/interrupt') {
            queueMicrotask(() => options.onNotification?.({
              method: 'turn/completed',
              params: {
                threadId: 'thread-abort',
                turn: { id: 'turn-abort', status: 'interrupted', error: null },
              },
            }));
            return {} as Result;
          }
          throw new Error(`Unexpected method ${method}`);
        },
        stop: () => {
          stopped = true;
        },
      }),
      turnTimeoutMs: 1_000,
    });

    expect(requests).toEqual(['thread/start', 'turn/start', 'turn/interrupt']);
    expect(result.status).toBe('interrupted');
    expect(stopped).toBeTrue();
  });
});

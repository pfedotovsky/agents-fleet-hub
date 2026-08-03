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

  test('maps reasoning lifecycle onto one normalized thinking id', async () => {
    const messages: NormalizedMessage[] = [];
    const sessionIds: string[] = [];
    const runtime = createCodexAppServerRuntime({
      resolveSelection: async () => ({ model: 'gpt-5.6-sol', effort: 'high' }),
      runConversation: async (_input, options) => {
        options?.onEvent?.({
          type: 'session',
          providerSessionId: 'thread-reasoning',
          effectiveSettings,
        });
        options?.onEvent?.({
          type: 'reasoning_summary',
          reasoning: { id: 'reasoning-1', summary: 'Reviewing' },
        });
        options?.onEvent?.({
          type: 'reasoning_summary',
          reasoning: { id: 'reasoning-1', summary: 'Reviewing\n\nChoosing adapter' },
        });
        options?.onEvent?.({ type: 'turn_complete', status: 'completed', error: null });
        return {
          providerSessionId: 'thread-reasoning',
          turnId: 'turn-reasoning',
          status: 'completed',
          error: null,
          emittedAssistantText: false,
          effectiveSettings,
        };
      },
    });

    await runtime.query('Think through the change', {
      projectPath: '/workspace/project',
      permissionMode: 'default',
    }, createWriter(messages, sessionIds));

    expect(messages.filter((message) => message.kind === 'thinking')).toEqual([
      expect.objectContaining({
        id: 'codex_app_server_reasoning-1',
        content: 'Reviewing',
      }),
      expect.objectContaining({
        id: 'codex_app_server_reasoning-1',
        content: 'Reviewing\n\nChoosing adapter',
      }),
    ]);
  });

  test('maps web-search lifecycle onto one normalized tool id', async () => {
    const messages: NormalizedMessage[] = [];
    const sessionIds: string[] = [];
    const runtime = createCodexAppServerRuntime({
      resolveSelection: async () => ({ model: 'gpt-5.6-sol', effort: 'high' }),
      runConversation: async (_input, options) => {
        options?.onEvent?.({
          type: 'session',
          providerSessionId: 'thread-search',
          effectiveSettings,
        });
        options?.onEvent?.({
          type: 'web_search',
          webSearch: {
            id: 'search-1',
            query: 'OpenAI Codex official docs',
            action: null,
            status: 'inProgress',
          },
        });
        options?.onEvent?.({
          type: 'web_search',
          webSearch: {
            id: 'search-1',
            query: 'OpenAI Codex official docs',
            action: { type: 'search', query: 'OpenAI Codex official docs' },
            status: 'completed',
          },
        });
        options?.onEvent?.({ type: 'turn_complete', status: 'completed', error: null });
        return {
          providerSessionId: 'thread-search',
          turnId: 'turn-search',
          status: 'completed',
          error: null,
          emittedAssistantText: false,
          effectiveSettings,
        };
      },
    });

    await runtime.query('Search official docs', {
      projectPath: '/workspace/project',
      permissionMode: 'default',
    }, createWriter(messages, sessionIds));

    expect(messages.filter((message) => message.kind === 'tool_use')).toEqual([
      expect.objectContaining({
        id: 'codex_app_server_search-1',
        toolName: 'WebSearch',
        toolId: 'search-1',
        toolInput: { query: 'OpenAI Codex official docs', action: null },
        status: 'inProgress',
      }),
      expect.objectContaining({
        id: 'codex_app_server_search-1',
        toolName: 'WebSearch',
        toolId: 'search-1',
        toolInput: {
          query: 'OpenAI Codex official docs',
          action: { type: 'search', query: 'OpenAI Codex official docs' },
        },
        status: 'completed',
      }),
    ]);
  });

  test('maps MCP lifecycle onto one normalized tool id with server and safe result', async () => {
    const messages: NormalizedMessage[] = [];
    const sessionIds: string[] = [];
    const runtime = createCodexAppServerRuntime({
      resolveSelection: async () => ({ model: 'gpt-5.6-sol', effort: 'high' }),
      runConversation: async (_input, options) => {
        options?.onEvent?.({
          type: 'session',
          providerSessionId: 'thread-mcp',
          effectiveSettings,
        });
        options?.onEvent?.({
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
        });
        options?.onEvent?.({
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
        });
        options?.onEvent?.({ type: 'turn_complete', status: 'completed', error: null });
        return {
          providerSessionId: 'thread-mcp',
          turnId: 'turn-mcp',
          status: 'completed',
          error: null,
          emittedAssistantText: false,
          effectiveSettings,
        };
      },
    });

    await runtime.query('Search official docs through MCP', {
      projectPath: '/workspace/project',
      permissionMode: 'default',
    }, createWriter(messages, sessionIds));

    expect(messages.filter((message) => message.kind === 'tool_use')).toEqual([
      expect.objectContaining({
        id: 'codex_app_server_mcp-1',
        toolName: 'search_openai_docs',
        toolId: 'mcp-1',
        toolInput: { query: 'Codex app server' },
        server: 'openaiDeveloperDocs',
        output: '',
        status: 'inProgress',
      }),
      expect.objectContaining({
        id: 'codex_app_server_mcp-1',
        toolName: 'search_openai_docs',
        toolId: 'mcp-1',
        toolInput: { query: 'Codex app server' },
        server: 'openaiDeveloperDocs',
        output: 'Found the Codex app-server docs.',
        status: 'completed',
        durationMs: 42,
      }),
    ]);
  });

  test('maps file-change lifecycle onto one normalized tool id', async () => {
    const messages: NormalizedMessage[] = [];
    const sessionIds: string[] = [];
    const changes = [{
      path: '/workspace/project/notes.txt',
      kind: { type: 'update' as const, move_path: null },
      diff: '@@ -1 +1 @@\n-old\n+new',
    }];
    const runtime = createCodexAppServerRuntime({
      resolveSelection: async () => ({ model: 'gpt-5.6-sol', effort: 'high' }),
      runConversation: async (_input, options) => {
        options?.onEvent?.({
          type: 'session',
          providerSessionId: 'thread-files',
          effectiveSettings,
        });
        options?.onEvent?.({
          type: 'file_change',
          fileChange: { id: 'file-change-1', changes, status: 'inProgress' },
        });
        options?.onEvent?.({
          type: 'file_change',
          fileChange: { id: 'file-change-1', changes, status: 'completed' },
        });
        options?.onEvent?.({ type: 'turn_complete', status: 'completed', error: null });
        return {
          providerSessionId: 'thread-files',
          turnId: 'turn-files',
          status: 'completed',
          error: null,
          emittedAssistantText: false,
          effectiveSettings,
        };
      },
    });

    await runtime.query('Update notes', {
      projectPath: '/workspace/project',
      permissionMode: 'default',
    }, createWriter(messages, sessionIds));

    expect(messages.filter((message) => message.kind === 'tool_use')).toEqual([
      expect.objectContaining({
        id: 'codex_app_server_file-change-1',
        toolName: 'FileChanges',
        toolId: 'file-change-1',
        toolInput: changes,
        status: 'inProgress',
      }),
      expect.objectContaining({
        id: 'codex_app_server_file-change-1',
        toolName: 'FileChanges',
        toolId: 'file-change-1',
        toolInput: changes,
        status: 'completed',
      }),
    ]);
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

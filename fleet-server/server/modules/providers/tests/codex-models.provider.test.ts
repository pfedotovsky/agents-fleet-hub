import { describe, expect, test } from 'bun:test';

import type { CodexAppServerHandshake } from '@/modules/providers/list/codex/codex-app-server-client.js';
import {
  CodexProviderModels,
  listCodexAppServerModels,
  type CodexAppServerModelClient,
} from '@/modules/providers/list/codex/codex-models.provider.js';

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

const appServerModel = (overrides: Record<string, unknown> = {}) => ({
  id: 'sol-id',
  model: 'gpt-5.6-sol',
  displayName: 'GPT-5.6 Sol',
  description: 'Frontier coding model',
  hidden: false,
  supportedReasoningEfforts: [
    { reasoningEffort: 'low', description: 'Fast' },
    { reasoningEffort: 'high', description: 'Thorough' },
  ],
  defaultReasoningEffort: 'low',
  inputModalities: ['text', 'image'],
  supportsPersonality: true,
  isDefault: true,
  ...overrides,
});

describe('Codex app-server model catalog', () => {
  test('pages model/list and maps provider metadata without guessing the default', async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    let stopped = false;
    const client: CodexAppServerModelClient = {
      start: async () => handshake,
      request: async <Result>(method: string, params: unknown): Promise<Result> => {
        requests.push({ method, params });
        const cursor = (params as { cursor?: string | null }).cursor;
        const response = cursor
          ? {
              data: [
                appServerModel({
                  id: 'terra-id',
                  model: 'gpt-5.6-terra',
                  displayName: 'GPT-5.6 Terra',
                  isDefault: false,
                  inputModalities: undefined,
                  supportsPersonality: false,
                }),
                appServerModel({ model: 'hidden-model', hidden: true, isDefault: false }),
              ],
              nextCursor: null,
            }
          : { data: [appServerModel()], nextCursor: 'page-2' };
        return response as Result;
      },
      stop: () => {
        stopped = true;
      },
    };

    const provider = new CodexProviderModels({
      createAppServerClient: () => client,
      readModelsCache: async () => {
        throw new Error('cache fallback should not be read');
      },
    });
    const models = await provider.getSupportedModels();

    expect(requests).toEqual([
      {
        method: 'model/list',
        params: { cursor: null, limit: 100, includeHidden: false },
      },
      {
        method: 'model/list',
        params: { cursor: 'page-2', limit: 100, includeHidden: false },
      },
    ]);
    expect(models).toEqual({
      OPTIONS: [
        {
          value: 'gpt-5.6-sol',
          label: 'GPT-5.6 Sol',
          description: 'Frontier coding model',
          inputModalities: ['text', 'image'],
          supportsPersonality: true,
          effort: {
            default: 'low',
            values: [
              { value: 'low', description: 'Fast' },
              { value: 'high', description: 'Thorough' },
            ],
          },
        },
        {
          value: 'gpt-5.6-terra',
          label: 'GPT-5.6 Terra',
          description: 'Frontier coding model',
          inputModalities: ['text', 'image'],
          supportsPersonality: false,
          effort: {
            default: 'low',
            values: [
              { value: 'low', description: 'Fast' },
              { value: 'high', description: 'Thorough' },
            ],
          },
        },
      ],
      DEFAULT: 'gpt-5.6-sol',
    });
    expect(stopped).toBeTrue();
  });

  test('keeps the existing cache path when app-server is disabled', async () => {
    const provider = new CodexProviderModels({
      createAppServerClient: () => null,
      readModelsCache: async () => JSON.stringify({
        models: [{
          slug: 'cached-codex',
          display_name: 'Cached Codex',
          visibility: 'list',
          priority: 1,
        }],
      }),
    });

    expect((await provider.getSupportedModels()).DEFAULT).toBe('cached-codex');
  });

  test('falls back to the existing Codex cache when app-server fails', async () => {
    let stopped = false;
    const diagnostics: string[] = [];
    const provider = new CodexProviderModels({
      createAppServerClient: () => ({
        start: async () => {
          throw new Error('unavailable');
        },
        request: async <Result>() => undefined as Result,
        stop: () => {
          stopped = true;
        },
      }),
      readModelsCache: async () => JSON.stringify({
        models: [{
          slug: 'cached-codex',
          display_name: 'Cached Codex',
          visibility: 'list',
          supported_in_api: true,
          priority: 1,
        }],
      }),
      onDiagnostic: (message) => diagnostics.push(message),
    });

    expect(await provider.getSupportedModels()).toEqual({
      OPTIONS: [{
        value: 'cached-codex',
        label: 'Cached Codex',
        description: undefined,
        effort: undefined,
      }],
      DEFAULT: 'cached-codex',
    });
    expect(stopped).toBeTrue();
    expect(diagnostics).toEqual([
      'Codex app-server model catalog unavailable; using the existing cache fallback',
    ]);
  });

  test('rejects a repeated pagination cursor instead of looping forever', async () => {
    const client: CodexAppServerModelClient = {
      start: async () => handshake,
      request: async <Result>(): Promise<Result> => ({
        data: [appServerModel()],
        nextCursor: 'same-cursor',
      }) as Result,
      stop: () => {},
    };

    await expect(listCodexAppServerModels(client)).rejects.toThrow(
      'repeated a model/list cursor',
    );
  });
});

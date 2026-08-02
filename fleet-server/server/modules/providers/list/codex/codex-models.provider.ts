import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import type { CodexAppServerClient } from './codex-app-server-client.js';
import { createCodexAppServerClientIfEnabled } from './codex-app-server-config.js';
import type {
  InputModality,
  ModelListParams,
  ModelListResponse,
} from './app-server-protocol/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

export const CODEX_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-5.5',
      label: 'gpt-5.5',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4',
      label: 'gpt-5.4',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4-mini',
      label: 'gpt-5.4-mini',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
  ],
  DEFAULT: 'gpt-5.4',
};

type CodexCachedModel = {
  slug?: string;
  display_name?: string;
  description?: string;
  priority?: number;
  visibility?: string;
  supported_in_api?: boolean;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{
    effort?: string;
    description?: string;
  }>;
};

export type CodexAppServerModelClient = Pick<
  CodexAppServerClient,
  'start' | 'request' | 'stop'
>;

type CodexProviderModelsDependencies = {
  createAppServerClient?: () => CodexAppServerModelClient | null;
  readModelsCache?: () => Promise<string>;
  onDiagnostic?: (message: string) => void;
};

const CODEX_MODELS_CACHE_PATH = path.join(os.homedir(), '.codex', 'models_cache.json');
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');
const MODEL_LIST_PAGE_LIMIT = 100;
const DEFAULT_INPUT_MODALITIES: InputModality[] = ['text', 'image'];

const isCodexCachedModel = (value: unknown): value is CodexCachedModel => {
  const record = readObjectRecord(value);
  return Boolean(record && readOptionalString(record.slug));
};

const readCodexPriority = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
);

const mapCodexModel = (model: CodexCachedModel): ProviderModelOption => {
  const effortValues = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels
      .map((level) => {
        const value = readOptionalString(level?.effort);
        if (!value) {
          return null;
        }

        return {
          value,
          description: readOptionalString(level?.description),
        };
      })
      .filter((level): level is NonNullable<typeof level> => Boolean(level))
    : [];

  return {
    value: model.slug as string,
    label: readOptionalString(model.display_name) ?? (model.slug as string),
    description: readOptionalString(model.description),
    effort: effortValues.length > 0
      ? {
          default: readOptionalString(model.default_reasoning_level) ?? undefined,
          values: effortValues,
        }
      : undefined,
  };
};

const buildCodexModelsDefinition = (models: CodexCachedModel[]): ProviderModelsDefinition => {
  const sortedModels = [...models]
    .filter((model) => model.visibility === 'list' && model.supported_in_api !== false)
    .sort((left, right) => readCodexPriority(left.priority) - readCodexPriority(right.priority));

  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of sortedModels) {
    const mappedModel = mapCodexModel(model);
    if (seenValues.has(mappedModel.value)) {
      continue;
    }

    seenValues.add(mappedModel.value);
    options.push(mappedModel);
  }

  if (options.length === 0) {
    return CODEX_FALLBACK_MODELS;
  }

  return {
    OPTIONS: options,
    DEFAULT: options[0]?.value ?? CODEX_FALLBACK_MODELS.DEFAULT,
  };
};

const isInputModality = (value: unknown): value is InputModality => (
  value === 'text' || value === 'image' || value === 'audio'
);

const mapCodexAppServerModel = (value: unknown): ProviderModelOption | null => {
  const model = readObjectRecord(value);
  const id = readOptionalString(model?.model) ?? readOptionalString(model?.id);
  if (!model || !id || model.hidden === true) {
    return null;
  }

  const effortValues = Array.isArray(model.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
      .map((entry) => {
        const effort = readObjectRecord(entry);
        const effortValue = readOptionalString(effort?.reasoningEffort);
        if (!effortValue) return null;
        return {
          value: effortValue,
          description: readOptionalString(effort?.description),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];

  const advertisedModalities = Array.isArray(model.inputModalities)
    ? model.inputModalities.filter(isInputModality)
    : [];

  return {
    value: id,
    label: readOptionalString(model.displayName) ?? id,
    description: readOptionalString(model.description),
    inputModalities: advertisedModalities.length > 0
      ? advertisedModalities
      : DEFAULT_INPUT_MODALITIES,
    supportsPersonality: model.supportsPersonality === true,
    effort: effortValues.length > 0
      ? {
          default: readOptionalString(model.defaultReasoningEffort) ?? undefined,
          values: effortValues,
        }
      : undefined,
  };
};

export const buildCodexAppServerModelsDefinition = (
  models: readonly unknown[],
): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();
  let defaultModel: string | null = null;

  for (const model of models) {
    const mapped = mapCodexAppServerModel(model);
    if (!mapped || seenValues.has(mapped.value)) continue;
    seenValues.add(mapped.value);
    options.push(mapped);

    const record = readObjectRecord(model);
    if (record?.isDefault === true && defaultModel === null) {
      defaultModel = mapped.value;
    }
  }

  if (options.length === 0) {
    throw new Error('Codex app-server returned no picker-visible models');
  }

  return {
    OPTIONS: options,
    DEFAULT: defaultModel ?? options[0].value,
  };
};

export const listCodexAppServerModels = async (
  client: CodexAppServerModelClient,
): Promise<unknown[]> => {
  await client.start();
  const models: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const params: ModelListParams = {
      cursor,
      limit: MODEL_LIST_PAGE_LIMIT,
      includeHidden: false,
    };
    const response = await client.request<ModelListResponse>('model/list', params);
    const responseRecord = readObjectRecord(response);
    if (!responseRecord || !Array.isArray(responseRecord.data)) {
      throw new Error('Codex app-server returned an invalid model/list response');
    }
    models.push(...responseRecord.data);

    const nextCursor = readOptionalString(responseRecord.nextCursor) ?? null;
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error('Codex app-server repeated a model/list cursor');
    }
    if (nextCursor) seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return models;
};

export class CodexProviderModels implements IProviderModels {
  private readonly createAppServerClient: () => CodexAppServerModelClient | null;
  private readonly readModelsCache: () => Promise<string>;
  private readonly onDiagnostic: (message: string) => void;

  constructor(dependencies: CodexProviderModelsDependencies = {}) {
    this.createAppServerClient = dependencies.createAppServerClient
      ?? (() => createCodexAppServerClientIfEnabled());
    this.readModelsCache = dependencies.readModelsCache
      ?? (() => readFile(CODEX_MODELS_CACHE_PATH, 'utf8'));
    this.onDiagnostic = dependencies.onDiagnostic
      ?? ((message) => console.warn(`[Codex] ${message}`));
  }

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const appServerClient = this.createAppServerClient();
    if (appServerClient) {
      try {
        const models = await listCodexAppServerModels(appServerClient);
        return buildCodexAppServerModelsDefinition(models);
      } catch {
        this.onDiagnostic(
          'Codex app-server model catalog unavailable; using the existing cache fallback',
        );
      } finally {
        appServerClient.stop();
      }
    }

    try {
      const raw = await this.readModelsCache();
      const parsed = readObjectRecord(JSON.parse(raw));
      const models = Array.isArray(parsed?.models)
        ? parsed.models.filter(isCodexCachedModel)
        : [];

      return buildCodexModelsDefinition(models);
    } catch {
      return CODEX_FALLBACK_MODELS;
    }
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    try {
      const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (!model) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      return {
        model,
      };
    } catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('codex', input);
  }
}

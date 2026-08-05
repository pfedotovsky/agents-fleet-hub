import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import { CodexAppServerClient } from './codex-app-server-client.js';
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

export type CodexAppServerModelClient = Pick<
  CodexAppServerClient,
  'start' | 'request' | 'stop'
>;

type CodexProviderModelsDependencies = {
  createAppServerClient?: () => CodexAppServerModelClient;
};

const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');
const MODEL_LIST_PAGE_LIMIT = 100;
const DEFAULT_INPUT_MODALITIES: InputModality[] = ['text', 'image'];

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
  private readonly createAppServerClient: () => CodexAppServerModelClient;

  constructor(dependencies: CodexProviderModelsDependencies = {}) {
    this.createAppServerClient = dependencies.createAppServerClient
      ?? (() => new CodexAppServerClient());
  }

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const appServerClient = this.createAppServerClient();
    try {
      const models = await listCodexAppServerModels(appServerClient);
      return buildCodexAppServerModelsDefinition(models);
    } finally {
      appServerClient.stop();
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

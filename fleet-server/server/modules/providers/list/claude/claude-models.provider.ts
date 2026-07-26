import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { sessionsDb } from '@/modules/database/index.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import { writeProviderSessionActiveModelChange } from '@/shared/utils.js';

/**
 * Canonical alias the Claude CLI uses for its recommended default model. The CLI
 * advertises a row with this `value`, and it is the model id we hand back when a
 * caller has not selected one explicitly.
 */
export const CLAUDE_DEFAULT_MODEL = 'default';

/**
 * Subset of the Claude Agent SDK `ModelInfo` shape we rely on. Typed locally so
 * the mapper stays resilient to SDK type churn and to unexpected runtime values.
 */
type ClaudeSupportedModel = {
  value?: unknown;
  displayName?: unknown;
  description?: unknown;
  supportsEffort?: unknown;
  supportedEffortLevels?: unknown;
};

const CLAUDE_PROBE_PROMPT = 'Get supported models';
const CLAUDE_PROBE_TIMEOUT_MS = 30_000;
const CLAUDE_PREFERRED_DEFAULT_EFFORT = 'high';

const buildClaudeModelOption = (model: ClaudeSupportedModel): ProviderModelOption | null => {
  const value = typeof model.value === 'string' ? model.value.trim() : '';
  if (!value) {
    return null;
  }

  const label = typeof model.displayName === 'string' && model.displayName.trim()
    ? model.displayName.trim()
    : value;

  const option: ProviderModelOption = { value, label };

  if (typeof model.description === 'string' && model.description.trim()) {
    option.description = model.description;
  }

  const effortLevels = Array.isArray(model.supportedEffortLevels)
    ? model.supportedEffortLevels.filter(
      (level): level is string => typeof level === 'string' && level.trim().length > 0,
    )
    : [];

  if (model.supportsEffort === true && effortLevels.length > 0) {
    option.effort = {
      default: effortLevels.includes(CLAUDE_PREFERRED_DEFAULT_EFFORT)
        ? CLAUDE_PREFERRED_DEFAULT_EFFORT
        : effortLevels[effortLevels.length - 1],
      values: effortLevels.map((level) => ({ value: level })),
    };
  }

  return option;
};

/**
 * Map the CLI's advertised model list onto the app's catalog shape. The CLI is
 * the sole source of truth, so newly released models appear automatically.
 * Throws when the CLI advertises nothing usable — there is no static fallback.
 */
export const buildClaudeModelsDefinition = (
  models: readonly ClaudeSupportedModel[],
): ProviderModelsDefinition => {
  const options = models
    .map(buildClaudeModelOption)
    .filter((option): option is ProviderModelOption => option !== null);

  if (options.length === 0) {
    throw new Error('Claude CLI returned no usable models');
  }

  const hasDefault = options.some((option) => option.value === CLAUDE_DEFAULT_MODEL);

  return {
    OPTIONS: options,
    DEFAULT: hasDefault ? CLAUDE_DEFAULT_MODEL : options[0].value,
  };
};

/**
 * Remove the throwaway workspace and its transcript.
 *
 * The CLI writes a session `.jsonl` under `~/.claude/projects/<encoded-cwd>/`,
 * keyed by the probe's cwd. Because we run the probe in a temp directory tagged
 * with a unique token, that transcript never attaches to a real workspace — and
 * deleting the token-tagged project dir keeps it out of the projects list too.
 */
const removeClaudeProbeArtifacts = async (probeCwd: string, token: string): Promise<void> => {
  await rm(probeCwd, { recursive: true, force: true }).catch(() => {});

  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    const entries = await readdir(projectsDir);
    await Promise.all(
      entries
        .filter((entry) => entry.includes(token))
        .map((entry) => rm(path.join(projectsDir, entry), { recursive: true, force: true }).catch(() => {})),
    );
  } catch {
    // Projects dir may not exist yet; nothing to clean up.
  }
};

const probeClaudeSupportedModels = async (): Promise<ClaudeSupportedModel[]> => {
  const token = randomUUID().replace(/-/g, '');
  const probeCwd = path.join(os.tmpdir(), `fleet-model-probe-${token}`);
  await mkdir(probeCwd, { recursive: true });

  const queryInstance = query({
    prompt: CLAUDE_PROBE_PROMPT,
    options: {
      cwd: probeCwd,
      permissionMode: 'bypassPermissions',
      pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
    },
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const models = await Promise.race([
      queryInstance.supportedModels(),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('Timed out probing Claude supported models')),
          CLAUDE_PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    return Array.isArray(models) ? (models as ClaudeSupportedModel[]) : [];
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    try {
      queryInstance.close();
    } catch {
      // Query may already be closed.
    }
    await removeClaudeProbeArtifacts(probeCwd, token);
  }
};

type ClaudeInitEvent = {
  sessionId?: string;
  session_id?: string;
  type?: string;
  subtype?: string;
  model?: string;
  message?: {
    content?: unknown;
    model?: string;
  };
};

const ANSI_PATTERN = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*(?:'
  + '(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]'
  + '|(?:[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
);

const extractClaudeEventModel = (event: ClaudeInitEvent, sessionId: string): string | null => {
  const eventSessionId = event.sessionId ?? event.session_id;
  if (eventSessionId && eventSessionId !== sessionId) {
    return null;
  }

  const contentModel = extractClaudeModelFromMessageContent(event.message?.content);
  if (contentModel) {
    return contentModel;
  }

  const directModel = event.model?.trim();
  if (directModel) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return messageModel || null;
};

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

const extractTaggedContent = (content: string, tagName: string): string | null => {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
};

const extractClaudeModelFromTextContent = (content: string): string | null => {
  const localCommandStdout = extractTaggedContent(content, 'local-command-stdout');
  if (localCommandStdout !== null) {
    const cleanedStdout = stripAnsi(localCommandStdout).replace(/\s+/g, ' ').trim();
    const changedModel = /(?:set|changed|switched)\s+model\s+to\s+(.+?)\.?$/i.exec(cleanedStdout);
    if (changedModel?.[1]?.trim()) {
      return changedModel[1].trim();
    }
  }

  const modelTag = extractTaggedContent(content, 'model')?.trim();
  return modelTag || null;
};

const extractClaudeModelFromMessageContent = (content: unknown): string | null => {
  if (typeof content === 'string') {
    return extractClaudeModelFromTextContent(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') {
      continue;
    }

    const model = extractClaudeModelFromTextContent(part.text);
    if (model) {
      return model;
    }
  }

  return null;
};

const readClaudeSessionModelFromJsonl = async (
  sessionId: string,
  jsonlPath: string,
): Promise<ProviderCurrentActiveModel | null> => {
  const content = await readFile(jsonlPath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as ClaudeInitEvent;
      const model = extractClaudeEventModel(event, sessionId);
      if (model) {
        return { model };
      }
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};

export class ClaudeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    // Probe the CLI for the live model list so newly released models appear
    // automatically. The probe runs in a throwaway temp workspace and cleans up
    // its transcript, so it never pollutes the real workspace session list
    // (see removeClaudeProbeArtifacts). There is no static fallback: any failure
    // propagates so the caller surfaces the error instead of a stale list.
    const supportedModels = await probeClaudeSupportedModels();
    return buildClaudeModelsDefinition(supportedModels);
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    // Fall back to the CLI's default alias when there is no session-backed model,
    // avoiding a CLI probe on every active-model lookup.
    if (!sessionId?.trim()) {
      return { model: CLAUDE_DEFAULT_MODEL };
    }

    try {
      const jsonlPath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
      const activeModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(sessionId, jsonlPath)
        : null;
      if (activeModel?.model) {
        return activeModel;
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return { model: CLAUDE_DEFAULT_MODEL };
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('claude', input);
  }
}

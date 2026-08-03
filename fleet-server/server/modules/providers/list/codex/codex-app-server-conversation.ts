import path from 'node:path';

import {
  CodexAppServerClient,
  type CodexAppServerClientOptions,
  type CodexAppServerNotification,
} from './codex-app-server-client.js';
import {
  createCodexAppServerRequestHandler,
  type CodexAppServerInteractionEvent,
} from './codex-app-server-interactions.js';
import { buildCodexInputItems } from '@/shared/image-attachments.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

const DEFAULT_TURN_TIMEOUT_MS = 30 * 60 * 1000;

export type CodexAppServerPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan';

export type CodexAppServerEffectiveSettings = {
  cwd: string;
  model: string;
  approvalPolicy: unknown;
  sandbox: unknown;
  reasoningEffort: string | null;
};

export type CodexAppServerTokenBudget = {
  used: number;
  total: number;
  inputTokens: number;
  outputTokens: number;
  breakdown: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
  };
};

export type CodexAppServerConversationEvent =
  | {
      type: 'session';
      providerSessionId: string;
      effectiveSettings: CodexAppServerEffectiveSettings;
    }
  | { type: 'assistant_delta'; itemId: string; delta: string }
  | { type: 'token_budget'; tokenBudget: CodexAppServerTokenBudget }
  | { type: 'warning'; message: string }
  | CodexAppServerInteractionEvent
  | {
      type: 'turn_complete';
      status: 'completed' | 'interrupted' | 'failed';
      error: string | null;
    };

export type CodexAppServerConversationInput = {
  cwd: string;
  prompt: string;
  providerSessionId?: string;
  model?: string;
  effort?: string;
  images?: unknown;
  permissionMode?: CodexAppServerPermissionMode;
  /** Used only by narrow probes; production Agents Hub threads are persisted. */
  ephemeral?: boolean;
};

export type CodexAppServerConversationResult = {
  providerSessionId: string;
  turnId: string;
  status: 'completed' | 'interrupted' | 'failed';
  error: string | null;
  emittedAssistantText: boolean;
  effectiveSettings: CodexAppServerEffectiveSettings;
};

type ClientFactory = (
  options: CodexAppServerClientOptions,
) => Pick<CodexAppServerClient, 'start' | 'request' | 'stop'>;

export type CodexAppServerConversationOptions = {
  createClient?: ClientFactory;
  onEvent?: (event: CodexAppServerConversationEvent) => void;
  turnTimeoutMs?: number;
  signal?: AbortSignal;
};

type QueuedNotification = CodexAppServerNotification;

class NotificationQueue {
  private readonly values: QueuedNotification[] = [];
  private readonly waiters: Array<(value: QueuedNotification) => void> = [];

  push(value: QueuedNotification): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  async shift(timeoutMs: number): Promise<QueuedNotification> {
    const value = this.values.shift();
    if (value) return value;

    return new Promise<QueuedNotification>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(resolveValue);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('Timed out waiting for Codex app-server turn completion'));
      }, Math.max(1, timeoutMs));
      const resolveValue = (notification: QueuedNotification) => {
        clearTimeout(timer);
        resolve(notification);
      };
      this.waiters.push(resolveValue);
    });
  }
}

function readFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readThreadResponse(value: unknown): {
  providerSessionId: string;
  effectiveSettings: CodexAppServerEffectiveSettings;
} {
  const response = readObjectRecord(value);
  const thread = readObjectRecord(response?.thread);
  const providerSessionId = readOptionalString(thread?.id);
  const cwd = readOptionalString(response?.cwd);
  const model = readOptionalString(response?.model);
  if (!response || !providerSessionId || !cwd || !model) {
    throw new Error('Codex app-server returned an invalid thread response');
  }

  return {
    providerSessionId,
    effectiveSettings: {
      cwd,
      model,
      approvalPolicy: response.approvalPolicy,
      sandbox: response.sandbox,
      reasoningEffort: readOptionalString(response.reasoningEffort) ?? null,
    },
  };
}

function readTurnId(value: unknown): string {
  const response = readObjectRecord(value);
  const turn = readObjectRecord(response?.turn);
  const turnId = readOptionalString(turn?.id);
  if (!turnId) throw new Error('Codex app-server returned an invalid turn response');
  return turnId;
}

function mapPermissionMode(permissionMode: CodexAppServerPermissionMode): {
  approvalPolicy: 'untrusted' | 'never';
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
} {
  switch (permissionMode) {
    case 'plan':
      return { approvalPolicy: 'never', sandbox: 'read-only' };
    case 'acceptEdits':
      return { approvalPolicy: 'never', sandbox: 'workspace-write' };
    case 'bypassPermissions':
      return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
    case 'default':
    default:
      return { approvalPolicy: 'untrusted', sandbox: 'workspace-write' };
  }
}

function buildAppServerInput(prompt: string, images: unknown, cwd: string): unknown[] {
  return buildCodexInputItems(prompt, images, cwd).map((item) => (
    item.type === 'local_image'
      ? { type: 'localImage', path: item.path }
      : { type: 'text', text: item.text, text_elements: [] }
  ));
}

function readTokenBudget(params: Record<string, unknown>): CodexAppServerTokenBudget | null {
  const usage = readObjectRecord(params.tokenUsage);
  const last = readObjectRecord(usage?.last);
  const contextWindow = readFiniteNumber(usage?.modelContextWindow);
  if (!last || contextWindow <= 0) return null;

  return {
    used: readFiniteNumber(last.totalTokens),
    total: contextWindow,
    inputTokens: readFiniteNumber(last.inputTokens),
    outputTokens: readFiniteNumber(last.outputTokens),
    breakdown: {
      input: readFiniteNumber(last.inputTokens),
      output: readFiniteNumber(last.outputTokens),
      cacheRead: readFiniteNumber(last.cachedInputTokens),
      cacheWrite: readFiniteNumber(last.cacheWriteInputTokens),
      reasoning: readFiniteNumber(last.reasoningOutputTokens),
    },
  };
}

function readTurnCompletion(params: Record<string, unknown>): {
  status: 'completed' | 'interrupted' | 'failed';
  error: string | null;
} | null {
  const turn = readObjectRecord(params.turn);
  const status = readOptionalString(turn?.status);
  if (status !== 'completed' && status !== 'interrupted' && status !== 'failed') {
    return null;
  }
  const error = readObjectRecord(turn?.error);
  return {
    status,
    error: readOptionalString(error?.message) ?? null,
  };
}

/**
 * Executes one app-server turn without exposing app-server outside fleet-server.
 * The caller owns policy/approval integration before selecting this path for
 * production chats; unsupported server requests fail closed in the client.
 */
export async function runCodexAppServerConversation(
  input: CodexAppServerConversationInput,
  options: CodexAppServerConversationOptions = {},
): Promise<CodexAppServerConversationResult> {
  const cwd = path.resolve(input.cwd);
  const permission = mapPermissionMode(input.permissionMode ?? 'default');
  const notifications = new NotificationQueue();
  const createClient = options.createClient
    ?? ((clientOptions) => new CodexAppServerClient(clientOptions));
  const onEvent = options.onEvent ?? (() => {});
  const timeoutMs = Math.max(1, options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS);
  const interactionAbort = new AbortController();
  let interruptError: Error | null = null;

  let providerSessionId = '';
  let turnId = '';
  let effectiveSettings: CodexAppServerEffectiveSettings | null = null;
  let emittedAssistantText = false;
  const deltaItemIds = new Set<string>();
  const client = createClient({
    onNotification: (notification) => notifications.push(notification),
    onServerRequest: createCodexAppServerRequestHandler({
      getProviderSessionId: () => providerSessionId,
      getTurnId: () => turnId,
      signal: interactionAbort.signal,
      onEvent,
    }),
  });
  const interruptTurn = () => {
    if (!providerSessionId || !turnId) return;
    void client.request('turn/interrupt', {
      threadId: providerSessionId,
      turnId,
    }).catch((error) => {
      interruptError = error instanceof Error
        ? error
        : new Error('Codex app-server turn interruption failed');
      notifications.push({ method: 'agents-hub/interrupt-failed' });
    });
  };

  try {
    await client.start();
    const threadParams = {
      cwd,
      model: input.model ?? null,
      approvalPolicy: permission.approvalPolicy,
      sandbox: permission.sandbox,
      ...(input.providerSessionId
        ? { threadId: input.providerSessionId }
        : {
            serviceName: 'agents_hub',
            ephemeral: input.ephemeral ?? false,
          }),
    };
    const threadResponse = await client.request<unknown>(
      input.providerSessionId ? 'thread/resume' : 'thread/start',
      threadParams,
    );
    const parsedThread = readThreadResponse(threadResponse);
    providerSessionId = parsedThread.providerSessionId;
    effectiveSettings = parsedThread.effectiveSettings;
    onEvent({ type: 'session', providerSessionId, effectiveSettings });

    const turnResponse = await client.request<unknown>('turn/start', {
      threadId: providerSessionId,
      input: buildAppServerInput(input.prompt, input.images, cwd),
      cwd,
      model: input.model ?? null,
      effort: input.effort ?? null,
    });
    turnId = readTurnId(turnResponse);
    if (options.signal?.aborted) interruptTurn();
    else options.signal?.addEventListener('abort', interruptTurn, { once: true });

    const deadline = Date.now() + timeoutMs;
    while (true) {
      const notification = await notifications.shift(deadline - Date.now());
      if (notification.method === 'agents-hub/interrupt-failed') {
        throw interruptError ?? new Error('Codex app-server turn interruption failed');
      }
      const params = readObjectRecord(notification.params);
      if (!params) continue;

      if (notification.method === 'configWarning') {
        const summary = readOptionalString(params.summary);
        const details = readOptionalString(params.details);
        if (summary) {
          onEvent({ type: 'warning', message: details ? `${summary}: ${details}` : summary });
        }
        continue;
      }

      const notificationThreadId = readOptionalString(params.threadId);
      if (notificationThreadId && notificationThreadId !== providerSessionId) continue;

      if (notification.method === 'warning') {
        const message = readOptionalString(params.message);
        if (message) onEvent({ type: 'warning', message });
        continue;
      }

      const notificationTurnId = readOptionalString(params.turnId);
      if (notificationTurnId && notificationTurnId !== turnId) continue;

      if (notification.method === 'item/agentMessage/delta') {
        const itemId = readOptionalString(params.itemId);
        const delta = typeof params.delta === 'string' ? params.delta : '';
        if (itemId && delta) {
          deltaItemIds.add(itemId);
          emittedAssistantText = true;
          onEvent({ type: 'assistant_delta', itemId, delta });
        }
        continue;
      }

      if (notification.method === 'item/completed') {
        const item = readObjectRecord(params.item);
        const itemId = readOptionalString(item?.id);
        const text = item?.type === 'agentMessage' ? readOptionalString(item.text) : undefined;
        if (itemId && text && !deltaItemIds.has(itemId)) {
          emittedAssistantText = true;
          onEvent({ type: 'assistant_delta', itemId, delta: text });
        }
        continue;
      }

      if (notification.method === 'thread/tokenUsage/updated') {
        const tokenBudget = readTokenBudget(params);
        if (tokenBudget) onEvent({ type: 'token_budget', tokenBudget });
        continue;
      }

      if (notification.method === 'turn/completed') {
        const completion = readTurnCompletion(params);
        if (!completion) continue;
        onEvent({ type: 'turn_complete', ...completion });
        return {
          providerSessionId,
          turnId,
          ...completion,
          emittedAssistantText,
          effectiveSettings,
        };
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', interruptTurn);
    interactionAbort.abort();
    client.stop();
  }
}

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

export type CodexAppServerCommandExecution = {
  id: string;
  command: string;
  cwd: string;
  status: 'inProgress' | 'completed' | 'failed' | 'declined';
  commandActions: unknown[];
  output: string;
  exitCode: number | null;
  durationMs: number | null;
};

export type CodexAppServerFileUpdateChange = {
  path: string;
  kind:
    | { type: 'add' }
    | { type: 'delete' }
    | { type: 'update'; move_path: string | null };
  diff: string;
};

export type CodexAppServerFileChange = {
  id: string;
  changes: CodexAppServerFileUpdateChange[];
  status: 'inProgress' | 'completed' | 'failed' | 'declined';
};

export type CodexAppServerReasoningSummary = {
  id: string;
  summary: string;
};

export type CodexAppServerWebSearch = {
  id: string;
  query: string;
  action: Record<string, unknown> | null;
  status: 'inProgress' | 'completed';
};

export type CodexAppServerMcpToolCall = {
  id: string;
  server: string;
  tool: string;
  arguments: unknown;
  status: 'inProgress' | 'completed' | 'failed';
  output: string;
  error: string | null;
  durationMs: number | null;
};

export type CodexAppServerPlanUpdate = {
  turnId: string;
  explanation: string | null;
  steps: Array<{
    step: string;
    status: 'pending' | 'inProgress' | 'completed';
  }>;
};

export type CodexAppServerCollaboration = {
  id: string;
  tool: 'spawnAgent' | 'sendInput' | 'resumeAgent' | 'wait' | 'closeAgent';
  status: 'inProgress' | 'completed' | 'failed';
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string | null;
  model: string | null;
  reasoningEffort: string | null;
  agents: Array<{
    threadId: string;
    status:
      | 'pendingInit'
      | 'running'
      | 'interrupted'
      | 'completed'
      | 'errored'
      | 'shutdown'
      | 'notFound';
    message: string | null;
  }>;
};

export type CodexAppServerSubAgentActivity = {
  id: string;
  kind: 'started' | 'interacted' | 'interrupted';
  agentThreadId: string;
  agentPath: string;
  status: 'inProgress' | 'completed';
};

export type CodexAppServerConversationEvent =
  | {
      type: 'session';
      providerSessionId: string;
      effectiveSettings: CodexAppServerEffectiveSettings;
    }
  | { type: 'assistant_delta'; itemId: string; delta: string }
  | { type: 'reasoning_summary'; reasoning: CodexAppServerReasoningSummary }
  | { type: 'web_search'; webSearch: CodexAppServerWebSearch }
  | { type: 'mcp_tool_call'; mcpToolCall: CodexAppServerMcpToolCall }
  | { type: 'plan_update'; planUpdate: CodexAppServerPlanUpdate }
  | { type: 'collaboration'; collaboration: CodexAppServerCollaboration }
  | { type: 'subagent_activity'; activity: CodexAppServerSubAgentActivity }
  | { type: 'command_execution'; command: CodexAppServerCommandExecution }
  | { type: 'file_change'; fileChange: CodexAppServerFileChange }
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

function readNullableFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((part) => typeof part !== 'string')) return null;
  return value as string[];
}

function readReasoningSummary(value: unknown): { id: string; sections: string[] } | null {
  const item = readObjectRecord(value);
  if (item?.type !== 'reasoning') return null;
  const id = readOptionalString(item.id);
  const sections = readStringArray(item.summary);
  return id && sections ? { id, sections } : null;
}

function joinReasoningSummary(sections: string[]): string {
  return sections.map((section) => section.trim()).filter(Boolean).join('\n\n');
}

function readWebSearch(
  value: unknown,
  status: CodexAppServerWebSearch['status'],
): CodexAppServerWebSearch | null {
  const item = readObjectRecord(value);
  if (item?.type !== 'webSearch') return null;
  const id = readOptionalString(item.id);
  const query = readOptionalString(item.query);
  const action = item.action == null ? null : readObjectRecord(item.action);
  if (!id || !query || (item.action != null && !action)) return null;
  return { id, query, action, status };
}

function readMcpTextContent(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.flatMap((part): string[] => {
    if (typeof part === 'string') return [part];
    const record = readObjectRecord(part);
    return typeof record?.text === 'string' ? [record.text] : [];
  }).filter((part) => part.trim()).join('\n');
}

function readMcpToolCall(value: unknown): CodexAppServerMcpToolCall | null {
  const item = readObjectRecord(value);
  if (item?.type !== 'mcpToolCall') return null;
  const id = readOptionalString(item.id);
  const server = readOptionalString(item.server);
  const tool = readOptionalString(item.tool);
  const status = readOptionalString(item.status);
  if (
    !id
    || !server
    || !tool
    || item.arguments === undefined
    || (status !== 'inProgress' && status !== 'completed' && status !== 'failed')
  ) {
    return null;
  }

  const result = readObjectRecord(item.result);
  const error = readObjectRecord(item.error);
  return {
    id,
    server,
    tool,
    arguments: item.arguments,
    status,
    output: readMcpTextContent(result?.content),
    error: readOptionalString(error?.message) ?? null,
    durationMs: readNullableFiniteNumber(item.durationMs),
  };
}

function readPlanUpdate(value: Record<string, unknown>): CodexAppServerPlanUpdate | null {
  const turnId = readOptionalString(value.turnId);
  if (!turnId || !Array.isArray(value.plan)) return null;
  const steps = value.plan.flatMap((candidate): CodexAppServerPlanUpdate['steps'] => {
    const entry = readObjectRecord(candidate);
    const step = readOptionalString(entry?.step);
    const status = readOptionalString(entry?.status);
    if (
      !step
      || (status !== 'pending' && status !== 'inProgress' && status !== 'completed')
    ) {
      return [];
    }
    return [{ step, status }];
  });
  if (steps.length === 0) return null;
  return {
    turnId,
    explanation: readOptionalString(value.explanation) ?? null,
    steps,
  };
}

function readCollaboration(value: unknown): CodexAppServerCollaboration | null {
  const item = readObjectRecord(value);
  if (item?.type !== 'collabAgentToolCall') return null;
  const id = readOptionalString(item.id);
  const tool = readOptionalString(item.tool);
  const status = readOptionalString(item.status);
  const senderThreadId = readOptionalString(item.senderThreadId);
  const receiverThreadIds = readStringArray(item.receiverThreadIds);
  if (
    !id
    || !senderThreadId
    || !receiverThreadIds
    || (tool !== 'spawnAgent'
      && tool !== 'sendInput'
      && tool !== 'resumeAgent'
      && tool !== 'wait'
      && tool !== 'closeAgent')
    || (status !== 'inProgress' && status !== 'completed' && status !== 'failed')
  ) {
    return null;
  }

  const agentsStates = readObjectRecord(item.agentsStates) ?? {};
  const agents = Object.entries(agentsStates).flatMap(
    ([threadId, value]): CodexAppServerCollaboration['agents'] => {
      const state = readObjectRecord(value);
      const agentStatus = readOptionalString(state?.status);
      if (
        agentStatus !== 'pendingInit'
        && agentStatus !== 'running'
        && agentStatus !== 'interrupted'
        && agentStatus !== 'completed'
        && agentStatus !== 'errored'
        && agentStatus !== 'shutdown'
        && agentStatus !== 'notFound'
      ) {
        return [];
      }
      return [{
        threadId,
        status: agentStatus,
        message: readOptionalString(state?.message) ?? null,
      }];
    },
  );

  return {
    id,
    tool,
    status,
    senderThreadId,
    receiverThreadIds,
    prompt: readOptionalString(item.prompt) ?? null,
    model: readOptionalString(item.model) ?? null,
    reasoningEffort: readOptionalString(item.reasoningEffort) ?? null,
    agents,
  };
}

function readSubAgentActivity(
  value: unknown,
  status: CodexAppServerSubAgentActivity['status'],
): CodexAppServerSubAgentActivity | null {
  const item = readObjectRecord(value);
  if (item?.type !== 'subAgentActivity') return null;
  const id = readOptionalString(item.id);
  const kind = readOptionalString(item.kind);
  const agentThreadId = readOptionalString(item.agentThreadId);
  const agentPath = readOptionalString(item.agentPath);
  if (
    !id
    || !agentThreadId
    || !agentPath
    || (kind !== 'started' && kind !== 'interacted' && kind !== 'interrupted')
  ) {
    return null;
  }
  return { id, kind, agentThreadId, agentPath, status };
}

function readCommandExecution(value: unknown): CodexAppServerCommandExecution | null {
  const item = readObjectRecord(value);
  if (item?.type !== 'commandExecution') return null;
  const id = readOptionalString(item.id);
  const command = readOptionalString(item.command);
  const cwd = readOptionalString(item.cwd);
  const status = readOptionalString(item.status);
  if (
    !id
    || !command
    || !cwd
    || (status !== 'inProgress'
      && status !== 'completed'
      && status !== 'failed'
      && status !== 'declined')
  ) {
    return null;
  }

  return {
    id,
    command,
    cwd,
    status,
    commandActions: Array.isArray(item.commandActions) ? item.commandActions : [],
    output: readOptionalString(item.aggregatedOutput) ?? '',
    exitCode: readNullableFiniteNumber(item.exitCode),
    durationMs: readNullableFiniteNumber(item.durationMs),
  };
}

function readFileUpdateChanges(value: unknown): CodexAppServerFileUpdateChange[] | null {
  if (!Array.isArray(value)) return null;

  const changes: CodexAppServerFileUpdateChange[] = [];
  for (const rawChange of value) {
    const change = readObjectRecord(rawChange);
    const kind = readObjectRecord(change?.kind);
    const path = readOptionalString(change?.path);
    const diff = typeof change?.diff === 'string' ? change.diff : null;
    if (!change || !kind || !path || diff === null) return null;

    if (kind.type === 'add' || kind.type === 'delete') {
      changes.push({ path, diff, kind: { type: kind.type } });
      continue;
    }
    if (kind.type === 'update') {
      const movePath = kind.move_path;
      if (movePath !== null && typeof movePath !== 'string') return null;
      changes.push({ path, diff, kind: { type: 'update', move_path: movePath } });
      continue;
    }
    return null;
  }
  return changes;
}

function readFileChange(value: unknown): CodexAppServerFileChange | null {
  const item = readObjectRecord(value);
  if (item?.type !== 'fileChange') return null;
  const id = readOptionalString(item.id);
  const status = readOptionalString(item.status);
  const changes = readFileUpdateChanges(item.changes);
  if (
    !id
    || !changes
    || (status !== 'inProgress'
      && status !== 'completed'
      && status !== 'failed'
      && status !== 'declined')
  ) {
    return null;
  }
  return { id, changes, status };
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
  const reasoningSummaries = new Map<string, string[]>();
  const commandExecutions = new Map<string, CodexAppServerCommandExecution>();
  const fileChanges = new Map<string, CodexAppServerFileChange>();
  const mcpToolCalls = new Map<string, CodexAppServerMcpToolCall>();
  const collaborations = new Map<string, CodexAppServerCollaboration>();
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
      summary: 'auto',
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

      if (notification.method === 'turn/plan/updated') {
        const planUpdate = readPlanUpdate(params);
        if (planUpdate) onEvent({ type: 'plan_update', planUpdate });
        continue;
      }

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

      if (notification.method === 'item/reasoning/summaryTextDelta') {
        const itemId = readOptionalString(params.itemId);
        const delta = typeof params.delta === 'string' ? params.delta : '';
        const summaryIndex = readNullableFiniteNumber(params.summaryIndex);
        if (itemId && delta && summaryIndex !== null && Number.isInteger(summaryIndex) && summaryIndex >= 0) {
          const sections = [...(reasoningSummaries.get(itemId) ?? [])];
          while (sections.length <= summaryIndex) sections.push('');
          sections[summaryIndex] = `${sections[summaryIndex]}${delta}`;
          reasoningSummaries.set(itemId, sections);
          const summary = joinReasoningSummary(sections);
          if (summary) onEvent({ type: 'reasoning_summary', reasoning: { id: itemId, summary } });
        }
        continue;
      }

      if (notification.method === 'item/reasoning/summaryPartAdded') {
        const itemId = readOptionalString(params.itemId);
        const summaryIndex = readNullableFiniteNumber(params.summaryIndex);
        if (itemId && summaryIndex !== null && Number.isInteger(summaryIndex) && summaryIndex >= 0) {
          const sections = [...(reasoningSummaries.get(itemId) ?? [])];
          while (sections.length <= summaryIndex) sections.push('');
          reasoningSummaries.set(itemId, sections);
        }
        continue;
      }

      // Raw reasoning is intentionally not part of the Hub protocol. Only the
      // provider-authored readable summary above is safe to surface.
      if (notification.method === 'item/reasoning/textDelta') continue;

      if (notification.method === 'item/started') {
        const reasoning = readReasoningSummary(params.item);
        if (reasoning) {
          reasoningSummaries.set(reasoning.id, reasoning.sections);
          const summary = joinReasoningSummary(reasoning.sections);
          if (summary) {
            onEvent({ type: 'reasoning_summary', reasoning: { id: reasoning.id, summary } });
          }
          continue;
        }
        const webSearch = readWebSearch(params.item, 'inProgress');
        if (webSearch) {
          onEvent({ type: 'web_search', webSearch });
          continue;
        }
        const mcpToolCall = readMcpToolCall(params.item);
        if (mcpToolCall) {
          mcpToolCalls.set(mcpToolCall.id, mcpToolCall);
          onEvent({ type: 'mcp_tool_call', mcpToolCall });
          continue;
        }
        const collaboration = readCollaboration(params.item);
        if (collaboration) {
          collaborations.set(collaboration.id, collaboration);
          onEvent({ type: 'collaboration', collaboration });
          continue;
        }
        const subAgentActivity = readSubAgentActivity(params.item, 'inProgress');
        if (subAgentActivity) {
          onEvent({ type: 'subagent_activity', activity: subAgentActivity });
          continue;
        }
        const command = readCommandExecution(params.item);
        if (command) {
          commandExecutions.set(command.id, command);
          onEvent({ type: 'command_execution', command });
          continue;
        }
        const fileChange = readFileChange(params.item);
        if (fileChange) {
          fileChanges.set(fileChange.id, fileChange);
          onEvent({ type: 'file_change', fileChange });
        }
        continue;
      }

      if (notification.method === 'item/mcpToolCall/progress') {
        const itemId = readOptionalString(params.itemId);
        const message = readOptionalString(params.message);
        const mcpToolCall = itemId ? mcpToolCalls.get(itemId) : undefined;
        if (mcpToolCall && message) {
          const updated = {
            ...mcpToolCall,
            output: mcpToolCall.output ? `${mcpToolCall.output}\n${message}` : message,
          };
          mcpToolCalls.set(updated.id, updated);
          onEvent({ type: 'mcp_tool_call', mcpToolCall: updated });
        }
        continue;
      }

      if (notification.method === 'item/commandExecution/outputDelta') {
        const itemId = readOptionalString(params.itemId);
        const delta = typeof params.delta === 'string' ? params.delta : '';
        const command = itemId ? commandExecutions.get(itemId) : undefined;
        if (command && delta) {
          const updated = { ...command, output: `${command.output}${delta}` };
          commandExecutions.set(command.id, updated);
          onEvent({ type: 'command_execution', command: updated });
        }
        continue;
      }

      if (notification.method === 'item/fileChange/patchUpdated') {
        const itemId = readOptionalString(params.itemId);
        const changes = readFileUpdateChanges(params.changes);
        const fileChange = itemId ? fileChanges.get(itemId) : undefined;
        if (fileChange && changes) {
          const updated = { ...fileChange, changes };
          fileChanges.set(fileChange.id, updated);
          onEvent({ type: 'file_change', fileChange: updated });
        }
        continue;
      }

      if (notification.method === 'item/completed') {
        const item = readObjectRecord(params.item);
        const reasoning = readReasoningSummary(item);
        if (reasoning) {
          reasoningSummaries.set(reasoning.id, reasoning.sections);
          const summary = joinReasoningSummary(reasoning.sections);
          if (summary) {
            onEvent({ type: 'reasoning_summary', reasoning: { id: reasoning.id, summary } });
          }
          continue;
        }
        const webSearch = readWebSearch(item, 'completed');
        if (webSearch) {
          onEvent({ type: 'web_search', webSearch });
          continue;
        }
        const mcpToolCall = readMcpToolCall(item);
        if (mcpToolCall) {
          const prior = mcpToolCalls.get(mcpToolCall.id);
          const completed = {
            ...mcpToolCall,
            output: mcpToolCall.output || mcpToolCall.error || prior?.output || '',
          };
          mcpToolCalls.set(completed.id, completed);
          onEvent({ type: 'mcp_tool_call', mcpToolCall: completed });
          continue;
        }
        const collaboration = readCollaboration(item);
        if (collaboration) {
          const prior = collaborations.get(collaboration.id);
          const completed = {
            ...collaboration,
            receiverThreadIds: collaboration.receiverThreadIds.length > 0
              ? collaboration.receiverThreadIds
              : prior?.receiverThreadIds ?? [],
            prompt: collaboration.prompt ?? prior?.prompt ?? null,
            model: collaboration.model ?? prior?.model ?? null,
            reasoningEffort: collaboration.reasoningEffort ?? prior?.reasoningEffort ?? null,
            agents: collaboration.agents.length > 0 ? collaboration.agents : prior?.agents ?? [],
          };
          collaborations.set(completed.id, completed);
          onEvent({ type: 'collaboration', collaboration: completed });
          continue;
        }
        const subAgentActivity = readSubAgentActivity(item, 'completed');
        if (subAgentActivity) {
          onEvent({ type: 'subagent_activity', activity: subAgentActivity });
          continue;
        }
        const command = readCommandExecution(item);
        if (command) {
          const prior = commandExecutions.get(command.id);
          const completed = {
            ...command,
            output: command.output || prior?.output || '',
          };
          commandExecutions.set(command.id, completed);
          onEvent({ type: 'command_execution', command: completed });
          continue;
        }
        const fileChange = readFileChange(item);
        if (fileChange) {
          fileChanges.set(fileChange.id, fileChange);
          onEvent({ type: 'file_change', fileChange });
          continue;
        }
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

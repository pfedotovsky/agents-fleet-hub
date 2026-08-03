import {
  runCodexAppServerConversation,
  type CodexAppServerConversationEvent,
  type CodexAppServerConversationInput,
  type CodexAppServerConversationOptions,
  type CodexAppServerConversationResult,
} from './codex-app-server-conversation.js';
import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { notifyRunFailed, notifyRunStopped } from '@/services/notification-orchestrator.js';
import type { AnyRecord, NormalizedMessage } from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

type RuntimeWriter = {
  userId?: string | number | null;
  send: (message: NormalizedMessage) => void;
  setSessionId?: (sessionId: string) => void;
};

type ActiveAppServerSession = {
  status: 'running' | 'aborted';
  abortController: AbortController;
  startedAt: string;
};

type ResolvedSelection = {
  model: string | undefined;
  effort: string | undefined;
};

type RuntimeDependencies = {
  runConversation: (
    input: CodexAppServerConversationInput,
    options?: CodexAppServerConversationOptions,
  ) => Promise<CodexAppServerConversationResult>;
  resolveSelection: (
    sessionId: string | undefined,
    model: string | undefined,
    effort: string | undefined,
  ) => Promise<ResolvedSelection>;
  isProviderInstalled: () => Promise<boolean>;
  notifyRunFailed: (input: AnyRecord) => void;
  notifyRunStopped: (input: AnyRecord) => void;
};

export type CodexAppServerRuntime = {
  query: (command: string, options: AnyRecord, writer: RuntimeWriter) => Promise<void>;
  abort: (providerSessionId: string) => boolean;
  isActive: (providerSessionId: string) => boolean;
};

function boundedMessage(value: unknown, fallback: string): string {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  const normalized = message.replace(/\s+/g, ' ').trim() || fallback;
  return normalized.length > 400 ? `${normalized.slice(0, 397)}…` : normalized;
}

async function resolveSelection(
  sessionId: string | undefined,
  model: string | undefined,
  effort: string | undefined,
): Promise<ResolvedSelection> {
  const resolvedModel = await providerModelsService.resolveResumeModel('codex', sessionId, model);
  const catalog = (await providerModelsService.getProviderModels('codex')).models;
  const selectedModel = catalog.OPTIONS.find((option) => option.value === resolvedModel) ?? null;
  const allowedEfforts = selectedModel?.effort?.values.map((value) => value.value) ?? [];
  return {
    model: resolvedModel,
    effort: typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
      ? effort
      : undefined,
  };
}

const defaultDependencies: RuntimeDependencies = {
  runConversation: runCodexAppServerConversation,
  resolveSelection,
  isProviderInstalled: () => providerAuthService.isProviderInstalled('codex'),
  notifyRunFailed: () => notifyRunFailed(),
  notifyRunStopped: () => notifyRunStopped(),
};

export function createCodexAppServerRuntime(
  dependencyOverrides: Partial<RuntimeDependencies> = {},
): CodexAppServerRuntime {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const activeSessions = new Map<string, ActiveAppServerSession>();

  const abort = (providerSessionId: string): boolean => {
    const session = activeSessions.get(providerSessionId);
    if (!session || session.status !== 'running') return false;
    session.status = 'aborted';
    session.abortController.abort();
    return true;
  };

  const isActive = (providerSessionId: string): boolean => (
    activeSessions.get(providerSessionId)?.status === 'running'
  );

  const query = async (
    command: string,
    options: AnyRecord = {},
    writer: RuntimeWriter,
  ): Promise<void> => {
    const sessionId = typeof options.sessionId === 'string' ? options.sessionId : undefined;
    const sessionSummary = typeof options.sessionSummary === 'string'
      ? options.sessionSummary
      : undefined;
    const cwd = typeof options.cwd === 'string'
      ? options.cwd
      : typeof options.projectPath === 'string'
        ? options.projectPath
        : process.cwd();
    const permissionMode = typeof options.permissionMode === 'string'
      ? options.permissionMode as CodexAppServerConversationInput['permissionMode']
      : 'default';
    const abortController = new AbortController();
    const assistantText = new Map<string, string>();
    let capturedSessionId = sessionId ?? '';
    let terminalSent = false;
    let sessionEntry: ActiveAppServerSession | null = null;

    const registerSession = (providerSessionId: string) => {
      if (!providerSessionId) return;
      if (providerSessionId === capturedSessionId && sessionEntry) {
        writer.setSessionId?.(providerSessionId);
        return;
      }
      capturedSessionId = providerSessionId;
      sessionEntry = {
        status: 'running',
        abortController,
        startedAt: new Date().toISOString(),
      };
      activeSessions.set(providerSessionId, sessionEntry);
      writer.setSessionId?.(providerSessionId);
    };

    const send = (fields: { kind: NormalizedMessage['kind']; [key: string]: unknown }) => {
      writer.send(createNormalizedMessage({
        ...fields,
        provider: 'codex',
        sessionId: capturedSessionId,
      }));
    };

    const isAborted = () => abortController.signal.aborted || sessionEntry?.status === 'aborted';

    if (capturedSessionId) registerSession(capturedSessionId);

    try {
      const requestedModel = typeof options.model === 'string' && options.model !== 'default'
        ? options.model
        : undefined;
      const selection = await dependencies.resolveSelection(
        sessionId,
        requestedModel,
        typeof options.effort === 'string' ? options.effort : undefined,
      );

      await dependencies.runConversation({
        cwd,
        prompt: command,
        providerSessionId: sessionId,
        model: selection.model,
        effort: selection.effort,
        images: options.images,
        permissionMode,
      }, {
        signal: abortController.signal,
        onEvent: (event: CodexAppServerConversationEvent) => {
          if (event.type === 'session') {
            registerSession(event.providerSessionId);
            send({
              kind: 'status',
              text: 'effective_settings',
              effectiveSettings: event.effectiveSettings,
              requestedPermissionMode: permissionMode,
            });
            return;
          }

          if (event.type === 'assistant_delta') {
            assistantText.set(
              event.itemId,
              `${assistantText.get(event.itemId) ?? ''}${event.delta}`,
            );
            return;
          }

          if (event.type === 'command_execution') {
            send({
              id: `codex_app_server_${event.command.id}`,
              kind: 'tool_use',
              toolName: 'Bash',
              toolId: event.command.id,
              toolInput: {
                command: event.command.command,
                cwd: event.command.cwd,
                commandActions: event.command.commandActions,
              },
              output: event.command.output,
              status: event.command.status,
              ...(event.command.exitCode === null ? {} : { exitCode: event.command.exitCode }),
              ...(event.command.durationMs === null ? {} : { durationMs: event.command.durationMs }),
            });
            return;
          }

          if (event.type === 'token_budget') {
            send({ kind: 'status', text: 'token_budget', tokenBudget: event.tokenBudget });
            return;
          }

          if (event.type === 'warning') {
            send({
              kind: 'status',
              text: 'provider_warning',
              content: boundedMessage(event.message, 'Codex applied a provider warning.'),
            });
            return;
          }

          if (event.type === 'permission_request') {
            send({
              kind: 'permission_request',
              requestId: event.requestId,
              toolName: event.toolName,
              input: event.input,
            });
            return;
          }

          if (event.type === 'permission_cancelled') {
            send({
              kind: 'permission_cancelled',
              requestId: event.requestId,
              reason: event.reason,
            });
            return;
          }

          if (event.type !== 'turn_complete' || isAborted()) return;

          let emittedAssistantText = false;
          for (const [itemId, content] of assistantText) {
            if (!content.trim()) continue;
            emittedAssistantText = true;
            send({
              id: `codex_app_server_${itemId}`,
              kind: 'text',
              role: 'assistant',
              content,
            });
          }

          if (event.status === 'failed' || event.error) {
            send({
              kind: 'error',
              content: boundedMessage(event.error, 'Codex app-server turn failed.'),
            });
          } else if (event.status === 'completed' && !emittedAssistantText) {
            send({
              kind: 'error',
              content: 'Codex completed the turn without producing any assistant output.',
            });
          }

          writer.send(createCompleteMessage({
            provider: 'codex',
            sessionId: capturedSessionId,
            actualSessionId: capturedSessionId,
            exitCode: event.status === 'completed' && !event.error ? 0 : 1,
          }));
          terminalSent = true;
        },
      });

      if (!isAborted() && !terminalSent) {
        writer.send(createCompleteMessage({
          provider: 'codex',
          sessionId: capturedSessionId,
          actualSessionId: capturedSessionId,
          exitCode: 1,
        }));
      }

      if (!isAborted() && terminalSent) {
        dependencies.notifyRunStopped({
          userId: writer.userId ?? null,
          provider: 'codex',
          sessionId: capturedSessionId || null,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
      }
    } catch (error) {
      if (!isAborted()) {
        const installed = await dependencies.isProviderInstalled();
        const content = installed
          ? `Codex app-server error: ${boundedMessage(error, 'The turn failed without details.')}`
          : 'Codex CLI is not configured. Please set up authentication first.';
        send({ kind: 'error', content });
        writer.send(createCompleteMessage({
          provider: 'codex',
          sessionId: capturedSessionId,
          actualSessionId: capturedSessionId,
          exitCode: 1,
        }));
        dependencies.notifyRunFailed({
          userId: writer.userId ?? null,
          provider: 'codex',
          sessionId: capturedSessionId || null,
          sessionName: sessionSummary,
          error,
        });
      }
    } finally {
      if (capturedSessionId && activeSessions.get(capturedSessionId) === sessionEntry) {
        activeSessions.delete(capturedSessionId);
      }
    }
  };

  return { query, abort, isActive };
}

const runtime = createCodexAppServerRuntime();

export const queryCodexAppServer = runtime.query;
export const abortCodexAppServerSession = runtime.abort;
export const isCodexAppServerSessionActive = runtime.isActive;

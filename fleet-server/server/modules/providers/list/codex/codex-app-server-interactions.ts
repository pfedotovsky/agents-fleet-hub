import type {
  CodexAppServerRequest,
  CodexAppServerRequestHandler,
} from './codex-app-server-client.js';
import {
  createPendingPermissionId,
  waitForPermissionDecision,
  type PermissionDecision,
} from '@/shared/pending-permissions.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

export type CodexAppServerInteractionRequest = {
  type: 'permission_request';
  requestId: string;
  toolName: 'Bash' | 'Edit' | 'NetworkAccess' | 'AskUserQuestion';
  input: unknown;
  providerSessionId: string;
};

export type CodexAppServerInteractionCancelled = {
  type: 'permission_cancelled';
  requestId: string;
  reason: 'timeout' | 'cancelled';
  providerSessionId: string;
};

export type CodexAppServerInteractionEvent =
  | CodexAppServerInteractionRequest
  | CodexAppServerInteractionCancelled;

export type CodexAppServerInteractionOptions = {
  getProviderSessionId: () => string;
  getTurnId: () => string;
  signal: AbortSignal;
  onEvent: (event: CodexAppServerInteractionEvent) => void;
};

type RequestScope = {
  params: Record<string, unknown>;
  providerSessionId: string;
};

type UserInputQuestion = {
  id: string;
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
};

function readRequestScope(
  request: CodexAppServerRequest,
  options: CodexAppServerInteractionOptions,
): RequestScope {
  const params = readObjectRecord(request.params);
  const providerSessionId = options.getProviderSessionId();
  const turnId = options.getTurnId();
  if (
    !params
    || !providerSessionId
    || !turnId
    || readOptionalString(params.threadId) !== providerSessionId
    || readOptionalString(params.turnId) !== turnId
  ) {
    throw new Error(`Codex app-server sent an out-of-scope request: ${request.method}`);
  }
  return { params, providerSessionId };
}

async function askHub(
  providerSessionId: string,
  toolName: CodexAppServerInteractionRequest['toolName'],
  input: unknown,
  options: CodexAppServerInteractionOptions,
  timeoutMs = 0,
): Promise<PermissionDecision | null> {
  const requestId = createPendingPermissionId('codex');
  const decision = waitForPermissionDecision(requestId, {
    provider: 'codex',
    providerSessionId,
    toolName,
    input,
    signal: options.signal,
    timeoutMs,
    onCancel: (reason) => options.onEvent({
      type: 'permission_cancelled',
      requestId,
      reason,
      providerSessionId,
    }),
  });
  options.onEvent({
    type: 'permission_request',
    requestId,
    toolName,
    input,
    providerSessionId,
  });
  return decision;
}

function approvalDecision(decision: PermissionDecision | null):
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel' {
  if (!decision || decision.cancelled) return 'cancel';
  if (!decision.allow) return 'decline';
  return decision.rememberEntry ? 'acceptForSession' : 'accept';
}

function readUserInputQuestions(value: unknown): UserInputQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error('Codex app-server request-user-input has an unsupported question count');
  }

  return value.map((raw) => {
    const question = readObjectRecord(raw);
    const id = readOptionalString(question?.id);
    const text = readOptionalString(question?.question);
    const header = readOptionalString(question?.header) ?? '';
    if (
      !question
      || !id
      || !text
      || question.isSecret !== false
      || question.isOther !== true
      || !Array.isArray(question.options)
    ) {
      throw new Error('Codex app-server request-user-input cannot be represented safely');
    }
    const parsedOptions = question.options.map((rawOption) => {
      const option = readObjectRecord(rawOption);
      const label = readOptionalString(option?.label);
      if (!option || !label) {
        throw new Error('Codex app-server request-user-input contains an invalid option');
      }
      return {
        label,
        description: readOptionalString(option.description) ?? '',
      };
    });
    if (parsedOptions.length < 1) {
      throw new Error('Codex app-server request-user-input requires visible options');
    }
    return { id, question: text, header, options: parsedOptions };
  });
}

function readQuestionAnswers(
  decision: PermissionDecision | null,
  questions: UserInputQuestion[],
): Record<string, { answers: string[] }> {
  if (!decision?.allow) return {};
  const updatedInput = readObjectRecord(decision.updatedInput);
  const answers = readObjectRecord(updatedInput?.answers);
  if (!answers) return {};

  return Object.fromEntries(questions.flatMap((question) => {
    const answer = readOptionalString(answers[question.question]);
    return answer ? [[question.id, { answers: [answer] }] as const] : [];
  }));
}

export function createCodexAppServerRequestHandler(
  options: CodexAppServerInteractionOptions,
): CodexAppServerRequestHandler {
  return async (request) => {
    const { params, providerSessionId } = readRequestScope(request, options);

    if (request.method === 'item/commandExecution/requestApproval') {
      const networkApprovalContext = readObjectRecord(params.networkApprovalContext);
      const input = {
        command: readOptionalString(params.command) ?? '',
        cwd: readOptionalString(params.cwd) ?? '',
        reason: readOptionalString(params.reason) ?? undefined,
        networkApprovalContext: networkApprovalContext ?? undefined,
        commandActions: Array.isArray(params.commandActions) ? params.commandActions : undefined,
      };
      const decision = await askHub(
        providerSessionId,
        networkApprovalContext ? 'NetworkAccess' : 'Bash',
        input,
        options,
      );
      return { decision: approvalDecision(decision) };
    }

    if (request.method === 'item/fileChange/requestApproval') {
      const decision = await askHub(providerSessionId, 'Edit', {
        itemId: readOptionalString(params.itemId) ?? '',
        reason: readOptionalString(params.reason) ?? undefined,
        grantRoot: readOptionalString(params.grantRoot) ?? undefined,
      }, options);
      return { decision: approvalDecision(decision) };
    }

    if (request.method === 'item/tool/requestUserInput') {
      const questions = readUserInputQuestions(params.questions);
      const input = {
        questions: questions.map((question) => ({
          question: question.question,
          header: question.header,
          options: question.options,
          multiSelect: false,
        })),
      };
      const autoResolutionMs = typeof params.autoResolutionMs === 'number'
        && Number.isInteger(params.autoResolutionMs)
        && params.autoResolutionMs > 0
        ? params.autoResolutionMs
        : 0;
      const decision = await askHub(
        providerSessionId,
        'AskUserQuestion',
        input,
        options,
        autoResolutionMs,
      );
      return { answers: readQuestionAnswers(decision, questions) };
    }

    throw new Error(`Unsupported Codex app-server request: ${request.method}`);
  };
}

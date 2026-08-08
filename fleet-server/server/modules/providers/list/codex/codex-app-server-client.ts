import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

import { VERSION } from '@/shared/build-info.js';
import {
  readCodexCliVersion,
  resolveCodexCliPath,
  type CodexCliVersion,
} from '@/shared/codex-cli-path.js';
import {
  CODEX_APP_SERVER_PROTOCOL_BASELINE,
  type InitializeParams,
  type InitializeResponse,
  type RequestId,
} from './app-server-protocol/index.js';

const SUPPORTED_CLI_MAJOR = 0;
const SUPPORTED_CLI_MINORS = new Set([146, 147]);
const DEFAULT_MAX_PENDING_REQUESTS = 64;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type SpawnAppServer = (
  command: string,
  args: readonly string[],
) => ChildProcessWithoutNullStreams;

export type CodexAppServerNotification = {
  method: string;
  params?: unknown;
};

export type CodexAppServerRequest = CodexAppServerNotification & {
  id: RequestId;
};

export type CodexAppServerRequestHandler = (
  request: CodexAppServerRequest,
) => Promise<unknown> | unknown;

export type CodexAppServerHandshake = {
  cliVersion: CodexCliVersion;
  protocolBaseline: string;
  initialize: InitializeResponse;
};

export type CodexAppServerState = 'stopped' | 'starting' | 'ready' | 'failed';

export type CodexAppServerClientOptions = {
  codexPath?: string;
  clientVersion?: string;
  maxPendingRequests?: number;
  requestTimeoutMs?: number;
  resolveCliPath?: () => string | null;
  readCliVersion?: (candidate: string) => CodexCliVersion | null;
  spawnAppServer?: SpawnAppServer;
  onNotification?: (notification: CodexAppServerNotification) => void;
  onServerRequest?: CodexAppServerRequestHandler;
  onDiagnostic?: (message: string) => void;
};

type RpcErrorBody = {
  code: number;
  message: string;
  data?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class CodexAppServerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CodexAppServerError';
  }
}

export class CodexAppServerRpcError extends CodexAppServerError {
  constructor(readonly rpcError: RpcErrorBody) {
    super(rpcError.message, `RPC_${rpcError.code}`);
    this.name = 'CodexAppServerRpcError';
  }
}

function defaultSpawnAppServer(
  command: string,
  args: readonly string[],
): ChildProcessWithoutNullStreams {
  return spawn(command, [...args], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function isSupportedCliVersion(version: CodexCliVersion): boolean {
  return version[0] === SUPPORTED_CLI_MAJOR && SUPPORTED_CLI_MINORS.has(version[1]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === 'string' || typeof value === 'number';
}

function validateInitializeResponse(value: unknown): InitializeResponse {
  if (
    !isRecord(value)
    || typeof value.userAgent !== 'string'
    || typeof value.codexHome !== 'string'
    || typeof value.platformFamily !== 'string'
    || typeof value.platformOs !== 'string'
  ) {
    throw new CodexAppServerError(
      'Codex app-server returned an invalid initialize response',
      'INVALID_HANDSHAKE',
    );
  }
  return value as InitializeResponse;
}

export class CodexAppServerClient {
  private readonly maxPendingRequests: number;
  private readonly requestTimeoutMs: number;
  private readonly resolveCliPath: () => string | null;
  private readonly readCliVersion: (candidate: string) => CodexCliVersion | null;
  private readonly spawnAppServer: SpawnAppServer;
  private readonly pending = new Map<RequestId, PendingRequest>();
  private process: ChildProcessWithoutNullStreams | null = null;
  private lines: ReadlineInterface | null = null;
  private nextRequestId = 1;
  private startPromise: Promise<CodexAppServerHandshake> | null = null;
  private stopping = false;
  private handshake: CodexAppServerHandshake | null = null;
  private currentState: CodexAppServerState = 'stopped';

  constructor(private readonly options: CodexAppServerClientOptions = {}) {
    this.maxPendingRequests = Math.max(
      1,
      options.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS,
    );
    this.requestTimeoutMs = Math.max(
      1,
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
    this.resolveCliPath = options.resolveCliPath ?? resolveCodexCliPath;
    this.readCliVersion = options.readCliVersion ?? readCodexCliVersion;
    this.spawnAppServer = options.spawnAppServer ?? defaultSpawnAppServer;
  }

  get state(): CodexAppServerState {
    return this.currentState;
  }

  get pendingRequestCount(): number {
    return this.pending.size;
  }

  async start(): Promise<CodexAppServerHandshake> {
    if (this.handshake && this.currentState === 'ready') return this.handshake;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startInternal(): Promise<CodexAppServerHandshake> {
    this.currentState = 'starting';
    this.stopping = false;

    const codexPath = this.options.codexPath ?? this.resolveCliPath();
    if (!codexPath) {
      this.currentState = 'failed';
      throw new CodexAppServerError('No Codex CLI is available', 'CLI_NOT_FOUND');
    }

    const cliVersion = this.readCliVersion(codexPath);
    if (!cliVersion || !isSupportedCliVersion(cliVersion)) {
      this.currentState = 'failed';
      const rendered = cliVersion?.join('.') ?? 'unknown';
      throw new CodexAppServerError(
        `Codex CLI ${rendered} is incompatible with the verified 0.146.x-0.147.x range `
          + `(generated protocol baseline ${CODEX_APP_SERVER_PROTOCOL_BASELINE})`,
        'UNSUPPORTED_CLI_VERSION',
      );
    }

    try {
      const child = this.spawnAppServer(codexPath, ['app-server', '--listen', 'stdio://']);
      this.attachProcess(child);

      const params: InitializeParams = {
        clientInfo: {
          name: 'agents_hub',
          title: 'Agents Hub',
          version: this.options.clientVersion ?? VERSION,
        },
        capabilities: null,
      };
      const initialize = validateInitializeResponse(
        await this.sendRequest('initialize', params, true),
      );
      await this.writeMessage({ method: 'initialized', params: {} });

      this.handshake = {
        cliVersion,
        protocolBaseline: CODEX_APP_SERVER_PROTOCOL_BASELINE,
        initialize,
      };
      this.currentState = 'ready';
      return this.handshake;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async request<Result>(method: string, params: unknown): Promise<Result> {
    if (this.currentState !== 'ready') {
      throw new CodexAppServerError('Codex app-server is not ready', 'NOT_READY');
    }
    return this.sendRequest(method, params, false) as Promise<Result>;
  }

  async notify(method: string, params: unknown): Promise<void> {
    if (this.currentState !== 'ready') {
      throw new CodexAppServerError('Codex app-server is not ready', 'NOT_READY');
    }
    await this.writeMessage({ method, params });
  }

  async restart(): Promise<CodexAppServerHandshake> {
    this.stop();
    return this.start();
  }

  stop(): void {
    this.stopping = true;
    this.rejectPending(new CodexAppServerError('Codex app-server stopped', 'STOPPED'));
    this.handshake = null;
    this.lines?.close();
    this.lines = null;

    const child = this.process;
    this.process = null;
    if (child) {
      child.stdin.end();
      child.kill('SIGTERM');
    }
    this.currentState = 'stopped';
    this.stopping = false;
  }

  private attachProcess(child: ChildProcessWithoutNullStreams): void {
    this.process = child;
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on('line', (line) => this.handleLine(line));
    // Drain stderr to avoid blocking the child. Do not log it: provider stderr
    // can contain user content or authentication diagnostics.
    child.stderr.resume();
    child.once('error', (error) => this.fail(error));
    child.once('exit', (code, signal) => {
      if (!this.stopping && this.process === child) {
        this.fail(new CodexAppServerError(
          `Codex app-server exited unexpectedly (${signal ?? code ?? 'unknown'})`,
          'PROCESS_EXIT',
        ));
      }
    });
  }

  private async sendRequest(
    method: string,
    params: unknown,
    allowStarting: boolean,
  ): Promise<unknown> {
    if (!this.process || (!allowStarting && this.currentState !== 'ready')) {
      throw new CodexAppServerError('Codex app-server is not connected', 'NOT_READY');
    }
    if (this.pending.size >= this.maxPendingRequests) {
      throw new CodexAppServerError(
        `Codex app-server pending request limit (${this.maxPendingRequests}) reached`,
        'CLIENT_OVERLOADED',
      );
    }

    const id = this.nextRequestId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexAppServerError(
          `Codex app-server request timed out: ${method}`,
          'REQUEST_TIMEOUT',
        ));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });

      void this.writeMessage({ id, method, params }).catch((error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new CodexAppServerError(
          `Failed to write Codex app-server request: ${method}`,
          'WRITE_FAILED',
          error,
        ));
      });
    });
  }

  private writeMessage(message: unknown): Promise<void> {
    const child = this.process;
    if (!child || child.stdin.destroyed || !child.stdin.writable) {
      return Promise.reject(new CodexAppServerError(
        'Codex app-server stdin is unavailable',
        'WRITE_FAILED',
      ));
    }

    return new Promise<void>((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.fail(new CodexAppServerError(
        'Codex app-server emitted malformed JSONL',
        'PROTOCOL_ERROR',
        error,
      ));
      return;
    }
    if (!isRecord(message)) return;

    if (isRequestId(message.id) && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.options.onDiagnostic?.(`Ignored response for unknown request id ${String(message.id)}`);
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (isRecord(message.error)) {
        pending.reject(new CodexAppServerRpcError({
          code: typeof message.error.code === 'number' ? message.error.code : -32000,
          message: typeof message.error.message === 'string'
            ? message.error.message
            : 'Codex app-server request failed',
          data: message.error.data,
        }));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method !== 'string') {
      this.options.onDiagnostic?.('Ignored app-server message without a method');
      return;
    }

    if (isRequestId(message.id)) {
      void this.handleServerRequest({
        id: message.id,
        method: message.method,
        params: message.params,
      });
      return;
    }

    this.options.onNotification?.({
      method: message.method,
      params: message.params,
    });
  }

  private async handleServerRequest(request: CodexAppServerRequest): Promise<void> {
    try {
      if (!this.options.onServerRequest) {
        await this.writeMessage({
          id: request.id,
          error: { code: -32601, message: `Unsupported server request: ${request.method}` },
        });
        return;
      }
      const result = await this.options.onServerRequest(request);
      await this.writeMessage({ id: request.id, result });
    } catch (error) {
      await this.writeMessage({
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : 'Server request handler failed',
        },
      }).catch(() => undefined);
    }
  }

  private fail(cause: unknown): void {
    if (this.stopping) return;
    const error = cause instanceof CodexAppServerError
      ? cause
      : new CodexAppServerError('Codex app-server transport failed', 'TRANSPORT_ERROR', cause);
    this.currentState = 'failed';
    this.handshake = null;
    this.rejectPending(error);
    this.lines?.close();
    this.lines = null;
    const child = this.process;
    this.process = null;
    if (child && !child.killed) child.kill('SIGTERM');
    this.options.onDiagnostic?.(error.message);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

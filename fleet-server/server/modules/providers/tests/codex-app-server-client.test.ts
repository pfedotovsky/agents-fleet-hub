import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, test } from 'bun:test';

import {
  CodexAppServerClient,
  CodexAppServerError,
} from '@/modules/providers/list/codex/codex-app-server-client.js';

type WireMessage = {
  id?: string | number;
  method?: string;
  params?: unknown;
};

class FakeAppServerProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly messages: WireMessage[] = [];
  killed = false;
  private buffer = '';

  constructor(private readonly onMessage: (message: WireMessage) => void) {
    super();
    this.stdin.on('data', (chunk) => {
      this.buffer += chunk.toString();
      while (this.buffer.includes('\n')) {
        const newline = this.buffer.indexOf('\n');
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line) as WireMessage;
        this.messages.push(message);
        this.onMessage(message);
      }
    });
  }

  send(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  crash(code = 1): void {
    this.emit('exit', code, null);
  }

  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  }

  asChildProcess(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams;
  }
}

const initializeResult = {
  userAgent: 'codex-app-server/0.146.0',
  codexHome: '/tmp/codex-home',
  platformFamily: 'unix',
  platformOs: 'macos',
};

function createReadyFake(
  afterInitialize?: (message: WireMessage, child: FakeAppServerProcess) => void,
): FakeAppServerProcess {
  let child: FakeAppServerProcess;
  child = new FakeAppServerProcess((message) => {
    if (message.method === 'initialize') {
      child.send({ id: message.id, result: initializeResult });
      return;
    }
    afterInitialize?.(message, child);
  });
  return child;
}

function clientFor(
  childFactory: () => FakeAppServerProcess,
  overrides: ConstructorParameters<typeof CodexAppServerClient>[0] = {},
): CodexAppServerClient {
  return new CodexAppServerClient({
    codexPath: '/fake/codex',
    clientVersion: 'test-version',
    readCliVersion: () => [0, 146, 0],
    spawnAppServer: () => childFactory().asChildProcess(),
    ...overrides,
  });
}

describe('CodexAppServerClient', () => {
  test('initializes with an honest identity and correlates out-of-order responses', async () => {
    const notifications: string[] = [];
    let firstRequest: WireMessage | null = null;
    const child = createReadyFake((message, current) => {
      if (message.method === 'initialized') {
        current.send({ method: 'thread/started', params: { thread: { id: 'thread-1' } } });
      } else if (message.method === 'first') {
        firstRequest = message;
      } else if (message.method === 'second') {
        current.send({ id: message.id, result: 'second-result' });
        current.send({ id: firstRequest?.id, result: 'first-result' });
      }
    });
    const client = clientFor(() => child, {
      onNotification: (notification) => notifications.push(notification.method),
    });

    const handshake = await client.start();
    const first = client.request<string>('first', { order: 1 });
    const second = client.request<string>('second', { order: 2 });

    expect(await Promise.all([first, second])).toEqual(['first-result', 'second-result']);
    expect(handshake).toEqual({
      cliVersion: [0, 146, 0],
      protocolBaseline: '0.147',
      initialize: initializeResult,
    });
    expect(child.messages.slice(0, 2)).toEqual([
      {
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: {
            name: 'agents_hub',
            title: 'Agents Hub',
            version: 'test-version',
          },
          capabilities: null,
        },
      },
      { method: 'initialized', params: {} },
    ]);
    expect(notifications).toEqual(['thread/started']);
    expect(client.state).toBe('ready');
    client.stop();
  });

  test('bounds pending requests and rejects them when stopped', async () => {
    const child = createReadyFake();
    const client = clientFor(() => child, { maxPendingRequests: 1 });
    await client.start();

    const first = client.request('never-responds', {}).catch((error: unknown) => error);
    await expect(client.request('over-limit', {})).rejects.toMatchObject({
      code: 'CLIENT_OVERLOADED',
    });
    expect(client.pendingRequestCount).toBe(1);

    client.stop();
    await expect(first).resolves.toMatchObject({ code: 'STOPPED' });
    expect(client.pendingRequestCount).toBe(0);
  });

  test('rejects in-flight work on process exit and can restart cleanly', async () => {
    const children: FakeAppServerProcess[] = [];
    const client = clientFor(() => {
      const child = createReadyFake((message, current) => {
        if (message.method === 'crash') current.crash();
      });
      children.push(child);
      return child;
    });

    await client.start();
    await expect(client.request('crash', {})).rejects.toMatchObject({ code: 'PROCESS_EXIT' });
    expect(client.state).toBe('failed');

    await client.restart();
    expect(children).toHaveLength(2);
    expect(client.state).toBe('ready');
    client.stop();
  });

  test('accepts the verified 0.147 CLI protocol', async () => {
    const client = new CodexAppServerClient({
      codexPath: '/fake/codex',
      readCliVersion: () => [0, 147, 0],
      spawnAppServer: () => createReadyFake().asChildProcess(),
    });

    await expect(client.start()).resolves.toMatchObject({
      cliVersion: [0, 147, 0],
      protocolBaseline: '0.147',
    });
    client.stop();
  });

  test('fails closed when the CLI version is outside the verified range', async () => {
    let spawned = false;
    const client = new CodexAppServerClient({
      codexPath: '/fake/codex',
      readCliVersion: () => [0, 148, 0],
      spawnAppServer: () => {
        spawned = true;
        return createReadyFake().asChildProcess();
      },
    });

    await expect(client.start()).rejects.toMatchObject({
      code: 'UNSUPPORTED_CLI_VERSION',
    });
    expect(spawned).toBeFalse();
    expect(client.state).toBe('failed');
  });

  test('reports RPC errors without failing the transport', async () => {
    const child = createReadyFake((message, current) => {
      if (message.method === 'bad-request') {
        current.send({ id: message.id, error: { code: 42, message: 'Nope' } });
      }
    });
    const client = clientFor(() => child);
    await client.start();

    await expect(client.request('bad-request', {})).rejects.toMatchObject({
      code: 'RPC_42',
      message: 'Nope',
    });
    expect(client.state).toBe('ready');
    client.stop();
  });
});

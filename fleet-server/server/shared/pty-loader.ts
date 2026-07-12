// Modified from CloudCLI 1.36.1 — see NOTICE.
// node-pty replacement backed by Bun's native PTY (Bun.Terminal + Bun.spawn).
// node-pty does not work under Bun (1.1.0 fails posix_spawnp; 1.2.0-beta hangs
// — see docs/bun-port-notes.md), and its native addon could not ship inside a
// compiled single-file binary anyway. This module exposes the subset of the
// node-pty API that shell-websocket.service.ts uses.

// Bun's runtime globals are typed via bun-types, which conflicts with
// @types/node in this mixed tree; access the runtime dynamically instead.
const BunRT = (globalThis as { Bun?: any }).Bun;

export interface IPtyExitEvent {
  exitCode: number;
  signal: number | string | null;
}

export interface IPty {
  readonly pid: number;
  onData(callback: (chunk: string) => void): void;
  onExit(callback: (event: IPtyExitEvent) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface IPtySpawnOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export function isPtySupported(): boolean {
  return Boolean(BunRT?.Terminal);
}

export function spawn(file: string, args: string[], options: IPtySpawnOptions = {}): IPty {
  if (!isPtySupported()) {
    throw new Error(
      'PTY support requires the Bun runtime (Bun.Terminal is unavailable) — the /shell terminal is disabled.'
    );
  }

  const decoder = new TextDecoder();
  const dataCallbacks: Array<(chunk: string) => void> = [];
  const exitCallbacks: Array<(event: IPtyExitEvent) => void> = [];

  const terminal = new BunRT.Terminal({
    cols: options.cols ?? 80,
    rows: options.rows ?? 24,
    data(_terminal: unknown, chunk: Uint8Array) {
      const text = decoder.decode(chunk);
      for (const callback of dataCallbacks) callback(text);
    },
  });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (options.name) env.TERM = env.TERM || options.name;

  const proc = BunRT.spawn([file, ...args], {
    terminal,
    cwd: options.cwd,
    env,
  });

  proc.exited.then(() => {
    try {
      terminal.close();
    } catch {
      // already closed
    }
    const event: IPtyExitEvent = {
      exitCode: proc.exitCode ?? 0,
      signal: proc.signalCode ?? null,
    };
    for (const callback of exitCallbacks) callback(event);
  });

  return {
    get pid() {
      return proc.pid;
    },
    onData(callback) {
      dataCallbacks.push(callback);
    },
    onExit(callback) {
      exitCallbacks.push(callback);
    },
    write(data) {
      terminal.write(data);
    },
    resize(cols, rows) {
      terminal.resize(cols, rows);
    },
    kill(signal) {
      try {
        proc.kill(signal ?? 'SIGHUP');
      } catch {
        // process already gone
      }
    },
  };
}

export default { spawn, isPtySupported };

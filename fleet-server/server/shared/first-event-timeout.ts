export class FirstEventTimeoutError extends Error {
  readonly code = 'FIRST_EVENT_TIMEOUT';

  constructor(timeoutMs: number, message?: string) {
    super(message ?? `No startup event received within ${timeoutMs} ms`);
    this.name = 'FirstEventTimeoutError';
  }
}

interface FirstEventTimeoutOptions<T> {
  timeoutMs: number;
  message?: string;
  onTimeout?: () => void;
  isReady?: (value: T) => boolean;
}

/**
 * Bounds the wait for an async stream's first qualifying event. Non-qualifying
 * startup events still pass through, but do not disarm the deadline. Once the
 * stream is ready, normal long-running/interactive behavior is left untouched.
 */
export async function* withFirstEventTimeout<T>(
  source: AsyncIterable<T>,
  options: FirstEventTimeoutOptions<T>,
): AsyncGenerator<T, void> {
  const iterator = source[Symbol.asyncIterator]();
  const startedAt = Date.now();
  const isReady = options.isReady ?? (() => true);

  while (true) {
    const remainingMs = Math.max(0, options.timeoutMs - (Date.now() - startedAt));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        try {
          options.onTimeout?.();
        } catch {
          // The timeout error is the actionable failure; cleanup is best-effort.
        }
        reject(new FirstEventTimeoutError(options.timeoutMs, options.message));
      }, remainingMs);
    });

    let next: IteratorResult<T>;
    try {
      next = await Promise.race([iterator.next(), timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    if (next.done) return;
    const ready = isReady(next.value);
    yield next.value;
    if (ready) break;
  }

  for await (const value of { [Symbol.asyncIterator]: () => iterator }) {
    yield value;
  }
}

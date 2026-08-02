import { describe, expect, test } from 'bun:test';

import {
  FirstEventTimeoutError,
  withFirstEventTimeout,
} from '@/shared/first-event-timeout.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('withFirstEventTimeout', () => {
  test('passes through a stream that starts before the deadline', async () => {
    async function* source() {
      yield 'first';
      yield 'second';
    }

    const values = [];
    for await (const value of withFirstEventTimeout(source(), { timeoutMs: 100 })) {
      values.push(value);
    }

    expect(values).toEqual(['first', 'second']);
  });

  test('fails and runs cleanup when no first event arrives', async () => {
    const never = deferred<IteratorResult<string>>();
    let cleanupCalls = 0;
    const source = {
      [Symbol.asyncIterator]: () => ({ next: () => never.promise }),
    };

    const consume = async () => {
      for await (const _value of withFirstEventTimeout(source, {
        timeoutMs: 10,
        message: 'Provider startup timed out',
        onTimeout: () => { cleanupCalls += 1; },
      })) {
        // No values are expected.
      }
    };

    await expect(consume()).rejects.toEqual(
      expect.objectContaining({
        name: 'FirstEventTimeoutError',
        code: 'FIRST_EVENT_TIMEOUT',
        message: 'Provider startup timed out',
      }),
    );
    expect(cleanupCalls).toBe(1);
    expect(new FirstEventTimeoutError(50)).toBeInstanceOf(Error);
  });

  test('does not impose a deadline between later events', async () => {
    const second = deferred<void>();
    async function* source() {
      yield 'first';
      await second.promise;
      yield 'second';
    }

    const values: string[] = [];
    const consume = (async () => {
      for await (const value of withFirstEventTimeout(source(), { timeoutMs: 10 })) {
        values.push(value);
      }
    })();

    await Bun.sleep(25);
    second.resolve();
    await consume;
    expect(values).toEqual(['first', 'second']);
  });

  test('does not disarm until a qualifying event arrives', async () => {
    const never = deferred<IteratorResult<{ type: string }>>();
    const source = {
      [Symbol.asyncIterator]: () => {
        let first = true;
        return {
          next: () => {
            if (first) {
              first = false;
              return Promise.resolve({ done: false as const, value: { type: 'system' } });
            }
            return never.promise;
          },
        };
      },
    };
    const values: string[] = [];

    const consume = async () => {
      for await (const value of withFirstEventTimeout(source, {
        timeoutMs: 10,
        isReady: (message) => message.type === 'assistant',
      })) {
        values.push(value.type);
      }
    };

    await expect(consume()).rejects.toBeInstanceOf(FirstEventTimeoutError);
    expect(values).toEqual(['system']);
  });
});

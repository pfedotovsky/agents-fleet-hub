import { describe, expect, test } from 'bun:test';

import {
  getPendingPermissionsForSession,
  resolvePendingPermission,
  waitForPermissionDecision,
} from '@/shared/pending-permissions.js';

describe('pending permission bridge', () => {
  test('resolves one provider-scoped request and removes it from reconnect state', async () => {
    const decision = waitForPermissionDecision('test:resolve', {
      provider: 'codex',
      providerSessionId: 'thread-1',
      toolName: 'Bash',
      input: { command: 'git status' },
    });

    expect(getPendingPermissionsForSession('claude', 'thread-1')).toEqual([]);
    expect(getPendingPermissionsForSession('codex', 'thread-1')).toEqual([
      expect.objectContaining({
        requestId: 'test:resolve',
        provider: 'codex',
        providerSessionId: 'thread-1',
        toolName: 'Bash',
        input: { command: 'git status' },
      }),
    ]);
    expect(resolvePendingPermission('test:resolve', {
      allow: true,
      rememberEntry: 'Bash(git:*)',
    })).toBeTrue();
    expect(await decision).toEqual({ allow: true, rememberEntry: 'Bash(git:*)' });
    expect(getPendingPermissionsForSession('codex', 'thread-1')).toEqual([]);
    expect(resolvePendingPermission('test:resolve', { allow: false })).toBeFalse();
  });

  test('cleans up timed-out and aborted requests', async () => {
    const cancellations: string[] = [];
    const timedOut = waitForPermissionDecision('test:timeout', {
      provider: 'claude',
      providerSessionId: 'session-1',
      toolName: 'Edit',
      input: {},
      timeoutMs: 5,
      onCancel: (reason) => cancellations.push(reason),
    });
    expect(await timedOut).toBeNull();

    const controller = new AbortController();
    const aborted = waitForPermissionDecision('test:abort', {
      provider: 'codex',
      providerSessionId: 'thread-2',
      toolName: 'Edit',
      input: {},
      signal: controller.signal,
      onCancel: (reason) => cancellations.push(reason),
    });
    controller.abort();
    expect(await aborted).toEqual({ allow: false, cancelled: true });
    expect(cancellations).toEqual(['timeout', 'cancelled']);
    expect(getPendingPermissionsForSession('codex', 'thread-2')).toEqual([]);
  });
});

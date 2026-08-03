import { describe, expect, test } from 'bun:test';

import { createCodexRuntimeRouter } from '@/modules/providers/list/codex/codex-runtime-router.js';

describe('Codex runtime router', () => {
  test('checks the feature flag for every query', async () => {
    const calls: string[] = [];
    let enabled = false;
    const router = createCodexRuntimeRouter({
      isAppServerEnabled: () => enabled,
      queryAppServer: async () => { calls.push('app-server'); },
      querySdk: async () => { calls.push('sdk'); },
    });
    const writer = { send: () => {} };

    await router.query('first', {}, writer);
    enabled = true;
    await router.query('second', {}, writer);

    expect(calls).toEqual(['sdk', 'app-server']);
  });

  test('aborts the active runtime and probes the SDK only when needed', () => {
    const calls: string[] = [];
    const appServerActive = createCodexRuntimeRouter({
      abortAppServer: () => { calls.push('app-server'); return true; },
      abortSdk: () => { calls.push('sdk'); return true; },
    });
    expect(appServerActive.abort('thread-1')).toBeTrue();
    expect(calls).toEqual(['app-server']);

    calls.length = 0;
    const sdkActive = createCodexRuntimeRouter({
      abortAppServer: () => { calls.push('app-server'); return false; },
      abortSdk: () => { calls.push('sdk'); return true; },
    });
    expect(sdkActive.abort('thread-2')).toBeTrue();
    expect(calls).toEqual(['app-server', 'sdk']);
  });
});

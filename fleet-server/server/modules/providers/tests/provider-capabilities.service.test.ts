import { describe, expect, test } from 'bun:test';

import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';

describe('provider capabilities', () => {
  test('advertises native Codex app-server interactions', () => {
    expect(providerCapabilitiesService.getProviderCapabilities('codex')).toMatchObject({
      supportsAbort: true,
      supportsPermissionRequests: true,
      supportsTokenUsage: true,
    });
  });
});

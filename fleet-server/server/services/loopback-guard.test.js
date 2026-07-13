import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateProbePayload, isWildcardHost } from './loopback-guard.js';

const OWN_ID = 'aaaaaaaa-1111-2222-3333-444444444444';

test('isWildcardHost accepts the wildcard spellings and rejects specific addresses', () => {
  assert.equal(isWildcardHost('0.0.0.0'), true);
  assert.equal(isWildcardHost('::'), true);
  assert.equal(isWildcardHost('*'), true);
  assert.equal(isWildcardHost('127.0.0.1'), false);
  assert.equal(isWildcardHost('::1'), false);
  assert.equal(isWildcardHost('192.168.1.10'), false);
});

test('evaluateProbePayload recognizes our own instance', () => {
  const verdict = evaluateProbePayload({ status: 'ok', instanceId: OWN_ID }, OWN_ID);
  assert.equal(verdict.shadowed, false);
});

test('evaluateProbePayload flags a foreign instance and surfaces its identity', () => {
  const verdict = evaluateProbePayload(
    {
      status: 'ok',
      instanceId: 'bbbbbbbb-5555-6666-7777-888888888888',
      version: '0.1.3',
      hostname: 'remote-vm',
      dataDir: '/home/user/.fleet-server',
      pid: 4242,
    },
    OWN_ID,
  );
  assert.equal(verdict.shadowed, true);
  assert.equal(verdict.foreign.hostname, 'remote-vm');
  assert.equal(verdict.foreign.pid, 4242);
});

test('evaluateProbePayload flags servers without an instanceId (older fleet-server, stock CloudCLI)', () => {
  const verdict = evaluateProbePayload({ status: 'ok', version: '0.1.2' }, OWN_ID);
  assert.equal(verdict.shadowed, true);
  assert.equal(verdict.foreign.instanceId, '(none)');
});

test('evaluateProbePayload flags non-object responses', () => {
  assert.equal(evaluateProbePayload(null, OWN_ID).shadowed, true);
  assert.equal(evaluateProbePayload('ok', OWN_ID).shadowed, true);
});

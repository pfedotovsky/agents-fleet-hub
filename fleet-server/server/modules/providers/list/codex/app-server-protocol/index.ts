/**
 * Minimal stable app-server protocol surface checked in from Codex CLI 0.146.0.
 * Add generated types only when a vertical slice consumes them; do not vendor
 * the full rapidly-changing schema into fleet-server.
 */
export type { ClientInfo } from './ClientInfo.js';
export type { InitializeCapabilities } from './InitializeCapabilities.js';
export type { InitializeParams } from './InitializeParams.js';
export type { InitializeResponse } from './InitializeResponse.js';
export type { RequestId } from './RequestId.js';

export const CODEX_APP_SERVER_PROTOCOL_BASELINE = '0.146';

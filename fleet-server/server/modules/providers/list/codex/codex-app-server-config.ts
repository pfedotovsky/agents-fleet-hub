import type { CodexAppServerClientOptions } from './codex-app-server-client.js';
import { CodexAppServerClient } from './codex-app-server-client.js';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isCodexAppServerEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return ENABLED_VALUES.has((environment.CODEX_APP_SERVER_ENABLED ?? '').trim().toLowerCase());
}

/**
 * Feature-flagged construction boundary for later provider slices. Nothing in
 * the existing SDK send path instantiates app-server unless the flag is on.
 */
export function createCodexAppServerClientIfEnabled(
  options: CodexAppServerClientOptions = {},
  environment: NodeJS.ProcessEnv = process.env,
): CodexAppServerClient | null {
  return isCodexAppServerEnabled(environment) ? new CodexAppServerClient(options) : null;
}

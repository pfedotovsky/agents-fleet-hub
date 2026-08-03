import { abortCodexSession as abortCodexSdkSession, queryCodex as queryCodexSdk } from '@/openai-codex.js';
import { isCodexAppServerEnabled } from './codex-app-server-config.js';
import {
  abortCodexAppServerSession,
  queryCodexAppServer,
} from './codex-app-server-runtime.js';

type RouterDependencies = {
  isAppServerEnabled: () => boolean;
  queryAppServer: typeof queryCodexAppServer;
  querySdk: typeof queryCodexSdk;
  abortAppServer: typeof abortCodexAppServerSession;
  abortSdk: typeof abortCodexSdkSession;
};

export function createCodexRuntimeRouter(
  overrides: Partial<RouterDependencies> = {},
) {
  const dependencies: RouterDependencies = {
    isAppServerEnabled: isCodexAppServerEnabled,
    queryAppServer: queryCodexAppServer,
    querySdk: queryCodexSdk,
    abortAppServer: abortCodexAppServerSession,
    abortSdk: abortCodexSdkSession,
    ...overrides,
  };

  const query = (...args: Parameters<typeof queryCodexAppServer>) => (
    dependencies.isAppServerEnabled()
      ? dependencies.queryAppServer(...args)
      : dependencies.querySdk(...args)
  );

  const abort = (providerSessionId: string): boolean => (
    dependencies.abortAppServer(providerSessionId)
      || dependencies.abortSdk(providerSessionId)
  );

  return { query, abort };
}

const router = createCodexRuntimeRouter();

export const queryCodex = router.query;
export const abortCodexSession = router.abort;

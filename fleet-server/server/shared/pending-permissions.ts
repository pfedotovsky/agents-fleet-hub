import crypto from 'node:crypto';

export type PermissionDecision = {
  allow: boolean;
  updatedInput?: unknown;
  message?: string;
  rememberEntry?: unknown;
  cancelled?: boolean;
};

export type PendingPermission = {
  requestId: string;
  provider: string;
  providerSessionId: string | null;
  toolName: string;
  input: unknown;
  context?: unknown;
  receivedAt: Date;
};

type PendingPermissionEntry = PendingPermission & {
  resolve: (decision: PermissionDecision | null) => void;
};

export type WaitForPermissionOptions = {
  provider: string;
  providerSessionId: string | null;
  toolName: string;
  input: unknown;
  context?: unknown;
  receivedAt?: Date;
  timeoutMs?: number;
  signal?: AbortSignal;
  onCancel?: (reason: 'timeout' | 'cancelled') => void;
};

const pendingPermissions = new Map<string, PendingPermissionEntry>();

export function createPendingPermissionId(provider: string): string {
  return `${provider}:${crypto.randomUUID()}`;
}

export function waitForPermissionDecision(
  requestId: string,
  options: WaitForPermissionOptions,
): Promise<PermissionDecision | null> {
  if (pendingPermissions.has(requestId)) {
    throw new Error(`Permission request id is already pending: ${requestId}`);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      pendingPermissions.delete(requestId);
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortHandler);
    };

    const finalize = (decision: PermissionDecision | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    const abortHandler = () => {
      options.onCancel?.('cancelled');
      finalize({ allow: false, cancelled: true });
    };

    if (options.signal?.aborted) {
      abortHandler();
      return;
    }

    if ((options.timeoutMs ?? 0) > 0) {
      timeout = setTimeout(() => {
        options.onCancel?.('timeout');
        finalize(null);
      }, options.timeoutMs);
    }

    options.signal?.addEventListener('abort', abortHandler, { once: true });
    pendingPermissions.set(requestId, {
      requestId,
      provider: options.provider,
      providerSessionId: options.providerSessionId,
      toolName: options.toolName,
      input: options.input,
      context: options.context,
      receivedAt: options.receivedAt ?? new Date(),
      resolve: finalize,
    });
  });
}

export function resolvePendingPermission(
  requestId: string,
  decision: PermissionDecision,
): boolean {
  const pending = pendingPermissions.get(requestId);
  if (!pending) return false;
  pending.resolve(decision);
  return true;
}

export function getPendingPermissionsForSession(
  provider: string,
  providerSessionId: string,
): PendingPermission[] {
  return Array.from(pendingPermissions.values())
    .filter((pending) => (
      pending.provider === provider && pending.providerSessionId === providerSessionId
    ))
    .map(({ resolve: _resolve, ...pending }) => pending);
}

// Modified from CloudCLI 1.36.1 — see NOTICE.
// fleet-server strips the push/desktop notification subsystem; this stub
// preserves the orchestrator API surface consumed by Claude and Codex runtime
// adapters so run lifecycle code stays diffable against upstream.

export function createNotificationEvent() {
  return null;
}

export function notifyRunFailed() {}

export function notifyRunStopped() {}

export function notifyRunCompleted() {}

export function notifyUserIfEnabled() {}

import type { FleetSession } from '../types'

/**
 * Shareable session deep-links.
 *
 * We use a hash fragment (`#/s/<hostId>/<projectId>/<sessionId>`) rather than a
 * real path so one build works at every mount point the app ships under —
 * Vite dev (`/`), fleet-server (`/fleet-hub/`) and the Tauri shell
 * (`tauri://localhost/`) — with no server-side routing config. A session id is
 * only unique within a host, and the client resolves a session from the
 * per-project list (there is no fetch-one-session endpoint), so the link has to
 * carry the host and project too.
 */
export interface SessionLink {
  hostId: string
  projectId: string
  sessionId: string
}

/** The `#/s/...` fragment for a session (no host/session guarantees checked). */
export function sessionHash(target: FleetSession): string {
  return `#/s/${encodeURIComponent(target.hostId)}/${encodeURIComponent(
    target.projectId,
  )}/${encodeURIComponent(target.session.id)}`
}

/** Parse a location hash back into a SessionLink, or null if it isn't one. */
export function parseSessionHash(hash: string): SessionLink | null {
  const match = hash.match(/^#\/s\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (!match) return null
  return {
    hostId: decodeURIComponent(match[1]),
    projectId: decodeURIComponent(match[2]),
    sessionId: decodeURIComponent(match[3]),
  }
}

/**
 * Absolute, copy-pasteable URL for a session, resolved against the page's base
 * so it stays correct under `/fleet-hub/`, `/`, and the Tauri shell.
 */
export function buildSessionUrl(target: FleetSession): string {
  return new URL(sessionHash(target), document.baseURI).href
}

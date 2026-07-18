import { useMemo, useState } from 'react'
import { ChevronDown, FolderTree, GitBranch, LoaderCircle, Plus } from 'lucide-react'
import type { FleetSession, HostRuntime, Project, Provider, SessionSummary } from '../types'
import { getProjectSessions } from '../lib/api'
import { getToken, loadLastProvider, saveToken } from '../lib/storage'
import { hostColor } from '../lib/format'
import { SessionRow } from './SessionRow'

interface Props {
  runtime: HostRuntime
  hostColorIdx: number
  project: Project
  onOpenSession: (target: FleetSession) => void
  onOpenFiles: () => void
  onOpenGit: () => void
  onArchiveSession: (sessionId: string) => void
}

export function ProjectPane({
  runtime,
  hostColorIdx,
  project,
  onOpenSession,
  onOpenFiles,
  onOpenGit,
  onArchiveSession,
}: Props) {
  const [extraSessions, setExtraSessions] = useState<SessionSummary[]>([])
  const [hasMore, setHasMore] = useState(project.sessionMeta.hasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const color = hostColor(hostColorIdx)

  const toTarget = (session: SessionSummary): FleetSession => ({
    key: `${runtime.config.id}:${session.id}`,
    hostId: runtime.config.id,
    hostName: runtime.config.name,
    hostColorIdx,
    baseUrl: runtime.config.baseUrl,
    projectName: project.displayName,
    projectPath: project.fullPath,
    projectId: project.projectId,
    session,
    href: `${runtime.config.baseUrl}/session/${session.id}`,
    stale: runtime.status !== 'online',
    justUpdated: false,
    running: runtime.runningSessionIds ? runtime.runningSessionIds.has(session.id) : undefined,
  })

  const sessions = useMemo(() => {
    const seen = new Set<string>()
    const merged: SessionSummary[] = []
    for (const session of [...project.sessions, ...extraSessions]) {
      if (seen.has(session.id)) continue
      seen.add(session.id)
      merged.push(session)
    }
    return merged
  }, [project.sessions, extraSessions])

  async function loadMore() {
    setLoadingMore(true)
    setError(null)
    try {
      const token = getToken(runtime.config.id)
      if (!token) throw new Error('Not signed in to this host')
      const page = await getProjectSessions(
        runtime.config.baseUrl,
        token,
        project.projectId,
        { limit: 30, offset: sessions.length },
        (refreshed) => saveToken(runtime.config.id, refreshed),
      )
      setExtraSessions((prev) => [...prev, ...page.sessions])
      setHasMore(page.sessionMeta.hasMore)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setLoadingMore(false)
    }
  }

  /**
   * Opens a draft chat. The real session is created on the first send, with the
   * provider chosen in the composer toggle (seeded from the last-picked one).
   */
  function startNewSession() {
    const last = loadLastProvider(runtime.config.id)
    const provider: Provider =
      last === 'claude' || last === 'codex' || last === 'opencode' ? last : 'claude'
    onOpenSession({
      // Stable per-project draft key so the pane doesn't remount on first send.
      key: `${runtime.config.id}::draft:${project.projectId}`,
      hostId: runtime.config.id,
      hostName: runtime.config.name,
      hostColorIdx,
      baseUrl: runtime.config.baseUrl,
      projectName: project.displayName,
      projectPath: project.fullPath,
      projectId: project.projectId,
      session: {
        id: '',
        provider,
        summary: '',
        messageCount: 0,
        lastActivity: new Date().toISOString(),
      },
      href: '',
      stale: runtime.status !== 'online',
      justUpdated: false,
      running: undefined,
    })
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
      <header
        className="sticky top-0 z-10 border-b border-line bg-canvas/90 px-6 py-4 backdrop-blur"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] text-fg-faint">
              <span className="inline-flex items-center gap-1 font-medium text-fg-muted">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                {runtime.config.name}
              </span>
              <span>·</span>
              <span className="tnum font-mono">{project.sessionMeta.total} sessions</span>
            </div>
            <h2 className="font-display truncate text-base font-semibold text-fg">{project.displayName}</h2>
            <p className="truncate font-mono text-xs text-fg-subtle">{project.fullPath}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onOpenFiles}
              disabled={runtime.status !== 'online'}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:bg-elevated disabled:opacity-50"
            >
              <FolderTree size={13} /> Files
            </button>
            <button
              type="button"
              onClick={onOpenGit}
              disabled={runtime.status !== 'online'}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:bg-elevated disabled:opacity-50"
            >
              <GitBranch size={13} /> Git
            </button>
            <button
              type="button"
              onClick={startNewSession}
              disabled={runtime.status !== 'online'}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50"
            >
              <Plus size={13} />
              New session
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-4">
        {sessions.length === 0 && (
          <p className="py-16 text-center text-sm text-fg-faint">
            No sessions in this project yet — start one above.
          </p>
        )}
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            item={toTarget(session)}
            onOpen={onOpenSession}
            onArchive={(item) => {
              // The fleet's optimistic removal only covers project.sessions —
              // locally paged-in extras must be dropped here too.
              setExtraSessions((prev) => prev.filter((s) => s.id !== item.session.id))
              onArchiveSession(item.session.id)
            }}
          />
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="mx-auto mt-2 inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs text-fg-muted transition-colors hover:bg-elevated disabled:opacity-50"
          >
            {loadingMore ? <LoaderCircle size={12} className="animate-spin" /> : <ChevronDown size={12} />}
            Load more sessions
          </button>
        )}
      </div>
    </div>
  )
}

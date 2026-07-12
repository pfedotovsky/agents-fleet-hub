import { useMemo, useState } from 'react'
import { ChevronDown, FolderTree, GitBranch, LoaderCircle, Plus } from 'lucide-react'
import type { FleetSession, HostRuntime, Project, Provider, SessionSummary } from '../types'
import { createSession, getProjectSessions } from '../lib/api'
import { getToken, loadLastProvider, saveLastProvider, saveToken } from '../lib/storage'
import { hostColor } from '../lib/format'
import { SessionRow } from './SessionRow'

const PROVIDERS: Provider[] = ['claude', 'codex', 'opencode']

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
  const [creating, setCreating] = useState(false)
  const [provider, setProvider] = useState<Provider>(() => {
    const last = loadLastProvider(runtime.config.id)
    return PROVIDERS.includes(last as Provider) ? (last as Provider) : 'claude'
  })
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

  async function startNewSession() {
    setCreating(true)
    setError(null)
    try {
      const token = getToken(runtime.config.id)
      if (!token) throw new Error('Not signed in to this host')
      const created = await createSession(
        runtime.config.baseUrl,
        token,
        provider,
        project.fullPath,
        (refreshed) => saveToken(runtime.config.id, refreshed),
      )
      saveLastProvider(runtime.config.id, provider)
      onOpenSession(
        toTarget({
          id: created.sessionId,
          provider: created.provider,
          summary: '',
          messageCount: 0,
          lastActivity: new Date().toISOString(),
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create a session')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
      <header
        className="sticky top-0 z-10 border-b border-ink-800 bg-ink-950/90 px-6 py-4 backdrop-blur"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] text-ink-500">
              <span className="inline-flex items-center gap-1 font-medium text-ink-400">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                {runtime.config.name}
              </span>
              <span>·</span>
              <span className="tnum font-mono">{project.sessionMeta.total} sessions</span>
            </div>
            <h2 className="font-display truncate text-base font-semibold text-ink-100">{project.displayName}</h2>
            <p className="truncate font-mono text-xs text-ink-600">{project.fullPath}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onOpenFiles}
              disabled={runtime.status !== 'online'}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-800 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:bg-ink-800 disabled:opacity-50"
            >
              <FolderTree size={13} /> Files
            </button>
            <button
              type="button"
              onClick={onOpenGit}
              disabled={runtime.status !== 'online'}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-800 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:bg-ink-800 disabled:opacity-50"
            >
              <GitBranch size={13} /> Git
            </button>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as Provider)}
              className="rounded-md border border-ink-800 bg-ink-900 px-2 py-1.5 text-xs text-ink-300 outline-none"
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void startNewSession()}
              disabled={creating || runtime.status !== 'online'}
              className="inline-flex items-center gap-1.5 rounded-md bg-brass-400 px-3 py-1.5 text-xs font-medium text-ink-950 transition-colors hover:bg-brass-300 disabled:opacity-50"
            >
              {creating ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} />}
              New session
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-4">
        {sessions.length === 0 && (
          <p className="py-16 text-center text-sm text-ink-500">
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
            className="mx-auto mt-2 inline-flex items-center gap-1 rounded-full border border-ink-800 px-3 py-1 text-xs text-ink-400 transition-colors hover:bg-ink-800 disabled:opacity-50"
          >
            {loadingMore ? <LoaderCircle size={12} className="animate-spin" /> : <ChevronDown size={12} />}
            Load more sessions
          </button>
        )}
      </div>
    </div>
  )
}

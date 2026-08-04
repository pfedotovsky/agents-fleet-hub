import { useMemo, useState } from 'react'
import { Archive, ChevronDown, FolderTree, GitBranch, LoaderCircle, Pencil, Plus, X } from 'lucide-react'
import type { FleetSession, HostRuntime, Project, Provider, SessionSummary } from '../types'
import { getProjectSessions } from '../lib/api'
import { getToken, loadLastProvider, saveToken } from '../lib/storage'
import { hostColor } from '../lib/format'
import { SessionRow } from './SessionRow'
import { ProjectRenameForm } from './ProjectRenameForm'

interface Props {
  runtime: HostRuntime
  hostColorIdx: number
  project: Project
  onOpenSession: (target: FleetSession) => void
  onOpenFiles: () => void
  onOpenGit: () => void
  onArchiveProject: () => Promise<void>
  onRenameProject: (displayName: string) => Promise<void>
  onArchiveSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, summary: string) => Promise<void>
}

export function ProjectPane({
  runtime,
  hostColorIdx,
  project,
  onOpenSession,
  onOpenFiles,
  onOpenGit,
  onArchiveProject,
  onRenameProject,
  onArchiveSession,
  onRenameSession,
}: Props) {
  const [extraSessions, setExtraSessions] = useState<SessionSummary[]>([])
  const [hasMore, setHasMore] = useState(project.sessionMeta.hasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [renaming, setRenaming] = useState(false)

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

  async function archiveProject() {
    setArchiving(true)
    setError(null)
    try {
      await onArchiveProject()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive project')
      setConfirmArchive(false)
    } finally {
      setArchiving(false)
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
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-full min-w-0 lg:w-auto lg:flex-1">
            <div className="flex items-center gap-2 text-[11px] text-fg-faint">
              <span className="inline-flex items-center gap-1 font-medium text-fg-muted">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                {runtime.config.name}
              </span>
              <span>·</span>
              <span className="tnum font-mono">{project.sessionMeta.total} sessions</span>
            </div>
            {renaming ? (
              <ProjectRenameForm
                displayName={project.displayName}
                onRename={onRenameProject}
                onCancel={() => setRenaming(false)}
                className="mt-0.5 max-w-md"
              />
            ) : (
              <div className="group/title flex min-w-0 items-center gap-1.5">
                <h2 className="font-display truncate text-base font-semibold text-fg">
                  {project.displayName}
                </h2>
                {runtime.status === 'online' && (
                  <button
                    type="button"
                    onClick={() => setRenaming(true)}
                    title="Rename project"
                    aria-label={`Rename ${project.displayName}`}
                    className="shrink-0 rounded p-1 text-fg-subtle opacity-0 transition-opacity hover:bg-elevated hover:text-fg group-hover/title:opacity-100 focus:opacity-100"
                  >
                    <Pencil size={13} />
                  </button>
                )}
              </div>
            )}
            <p className="truncate font-mono text-xs text-fg-subtle">{project.fullPath}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
            {confirmArchive ? (
              <div
                role="group"
                aria-label="Confirm project archive"
                className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-1"
              >
                <span className="hidden text-xs text-fg-muted sm:inline">
                  Hide project and sessions?
                </span>
                <button
                  type="button"
                  onClick={() => void archiveProject()}
                  disabled={archiving}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-warning hover:bg-elevated disabled:opacity-50"
                >
                  {archiving ? <LoaderCircle size={12} className="animate-spin" /> : <Archive size={12} />}
                  Archive
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmArchive(false)}
                  disabled={archiving}
                  aria-label="Cancel project archive"
                  className="rounded p-0.5 text-fg-faint hover:bg-elevated hover:text-fg disabled:opacity-50"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                disabled={runtime.status !== 'online'}
                title="Archive project without deleting files or sessions"
                className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:bg-elevated disabled:opacity-50"
              >
                <Archive size={13} /> Archive
              </button>
            )}
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
            onRename={async (item, summary) => {
              await onRenameSession(item.session.id, summary)
              setExtraSessions((prev) =>
                prev.map((session) =>
                  session.id === item.session.id ? { ...session, summary } : session,
                ),
              )
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

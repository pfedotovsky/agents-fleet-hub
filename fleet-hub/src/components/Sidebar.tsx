import { useRef, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Folder,
  Inbox,
  KeyRound,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  MoonStar,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Trash2,
  UserPlus,
} from 'lucide-react'
import type { ArchivedSession, HostRuntime, Project, SessionSummary } from '../types'
import type { View } from '../App'
import { getArchivedSessions } from '../lib/api'
import { hostColor, relativeTime, sessionLive } from '../lib/format'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  getToken,
  loadLastProvider,
  loadSidebarWidth,
  saveSidebarWidth,
  saveToken,
} from '../lib/storage'
import { PROVIDER_META } from './Messages'

const COLLAPSED_COUNT = 7
/** How many chats to show under an expanded project before deferring to the project pane. */
const SESSIONS_PER_PROJECT = 6

interface Props {
  hosts: HostRuntime[]
  recent: Record<string, number>
  view: View
  onSelectFeed: () => void
  onSelectProject: (hostId: string, projectId: string) => void
  onOpenSession: (hostId: string, projectId: string, session: SessionSummary) => void
  onNewSession: (hostId: string, projectId: string) => void
  /** `hostId:projectId` of the project whose session is being created, if any. */
  creatingKey: string | null
  onToggleStar: (hostId: string, projectId: string) => void
  onArchiveSession: (hostId: string, sessionId: string) => void
  onRestoreSession: (hostId: string, sessionId: string) => Promise<void>
  onDeleteSessionForever: (hostId: string, sessionId: string) => Promise<void>
  onSignIn: (hostId: string) => void
  onOpenSettings: () => void
  onOpenSearch: () => void
  onRefresh: () => void
  /** Dev-only: opens the Backlog panel. Present only under import.meta.env.DEV. */
  onOpenBacklog?: () => void
}

/** Recency = latest of client "last opened" and the project's newest session activity. */
function recencyKey(project: Project, hostId: string, recent: Record<string, number>): number {
  const clientRecent = recent[`${hostId}:${project.projectId}`] ?? 0
  const sessionRecent = project.sessions.reduce((max, session) => {
    const t = Date.parse(session.lastActivity)
    return Number.isNaN(t) ? max : Math.max(max, t)
  }, 0)
  return Math.max(clientRecent, sessionRecent)
}

function HostStatusHint({ runtime, onSignIn }: { runtime: HostRuntime; onSignIn: (hostId: string) => void }) {
  switch (runtime.status) {
    case 'loading':
      return <LoaderCircle size={12} className="animate-spin text-fg-subtle" />
    case 'offline':
      return (
        <span title="Offline — wake the VM and run HOST=:: cloudcli">
          <MoonStar size={12} className="text-fg-subtle" />
        </span>
      )
    case 'needs-auth':
      return (
        <button
          type="button"
          onClick={() => onSignIn(runtime.config.id)}
          title={`Sign in to ${runtime.config.name}`}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[12px] font-medium text-amber-400 hover:bg-elevated"
        >
          <KeyRound size={12} /> sign in
        </button>
      )
    case 'needs-setup':
      return (
        <button
          type="button"
          onClick={() => onSignIn(runtime.config.id)}
          title={`Create the first account on ${runtime.config.name}`}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[12px] font-medium text-sky-400 hover:bg-elevated"
        >
          <UserPlus size={12} /> set up
        </button>
      )
    default:
      return null
  }
}

function SessionLink({
  session,
  active,
  runningIds,
  onOpen,
  onArchive,
}: {
  session: SessionSummary
  active: boolean
  runningIds: ReadonlySet<string> | undefined
  onOpen: () => void
  onArchive: () => void
}) {
  const title = session.summary || 'Untitled session'
  const running = sessionLive(runningIds, session.id, session.lastActivity)
  const providerMeta = PROVIDER_META[session.provider] ?? { label: session.provider, color: '#71717a', Icon: MessageSquare }
  return (
    <div
      className={`group/session flex w-full min-w-0 items-center rounded-md pr-1 transition-colors ${
        active ? 'bg-elevated' : 'hover:bg-surface'
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        title={title}
        className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 pr-1 text-sm ${
          active ? 'text-fg' : 'text-fg-faint hover:text-fg-secondary'
        }`}
      >
        <span className="inline-flex shrink-0" title={providerMeta.label}>
          <providerMeta.Icon size={12} style={{ color: providerMeta.color }} />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {running ? (
          <span
            title={runningIds ? 'Agent is running' : 'Active in the last 2 minutes'}
            className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-emerald-400"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            {runningIds ? 'running' : 'active'}
          </span>
        ) : (
          <span className="tnum shrink-0 font-mono text-[12px] text-fg-subtle">
            {relativeTime(session.lastActivity)}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onArchive}
        title="Archive (restorable)"
        className="shrink-0 rounded p-1 text-fg-subtle opacity-0 transition-opacity hover:bg-elevated-strong hover:text-fg group-hover/session:opacity-100"
      >
        <Archive size={12} />
      </button>
    </div>
  )
}

function ProjectRow({
  project,
  active,
  activeSessionId,
  dimmed,
  expanded,
  creating,
  canCreate,
  newSessionTitle,
  runningIds,
  onToggleExpand,
  onSelect,
  onOpenSession,
  onNewSession,
  onToggleStar,
  onArchiveSession,
}: {
  project: Project
  active: boolean
  activeSessionId: string | null
  dimmed: boolean
  expanded: boolean
  creating: boolean
  canCreate: boolean
  newSessionTitle: string
  runningIds: ReadonlySet<string> | undefined
  onToggleExpand: () => void
  onSelect: () => void
  onOpenSession: (session: SessionSummary) => void
  onNewSession: () => void
  onToggleStar: () => void
  onArchiveSession: (sessionId: string) => void
}) {
  const sessions = expanded
    ? [...project.sessions]
        .sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity))
        .slice(0, SESSIONS_PER_PROJECT)
    : []
  const hasActivity = project.sessions.some((session) =>
    sessionLive(runningIds, session.id, session.lastActivity),
  )
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <div className={dimmed ? 'opacity-60' : ''}>
      <div
        className={`group flex items-center rounded-md pr-1 transition-colors ${
          active ? 'bg-elevated' : 'hover:bg-surface'
        }`}
      >
        <button
          type="button"
          onClick={onToggleExpand}
          title={expanded ? 'Hide chats' : 'Show chats'}
          className="shrink-0 rounded p-0.5 pl-1.5 text-fg-subtle hover:text-fg-secondary"
        >
          <Chevron size={13} />
        </button>
        <button
          type="button"
          onClick={onSelect}
          title={project.fullPath}
          className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 text-[15px] ${
            active ? 'text-fg' : 'text-fg-muted'
          }`}
        >
          <Folder size={14} className="shrink-0 text-fg-subtle" />
          <span className="min-w-0 flex-1 truncate text-left">{project.displayName}</span>
          {hasActivity && (
            <span
              title={runningIds ? 'Has a running agent' : 'Has a session active in the last 2 minutes'}
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400"
            />
          )}
          <span className="tnum shrink-0 font-mono text-[12px] text-fg-subtle">
            {project.sessionMeta.total}
          </span>
        </button>
        {canCreate && (
          <button
            type="button"
            onClick={onNewSession}
            disabled={creating}
            title={newSessionTitle}
            className={`shrink-0 rounded p-1 text-fg-subtle transition-opacity hover:bg-elevated-strong hover:text-fg ${
              creating ? '' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            {creating ? (
              <LoaderCircle size={13} className="animate-spin text-fg-muted" />
            ) : (
              <Plus size={13} />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleStar}
          title={project.isStarred ? 'Unpin' : 'Pin'}
          className={`shrink-0 rounded p-1 transition-opacity hover:bg-elevated-strong ${
            project.isStarred ? 'text-amber-400' : 'text-fg-subtle opacity-0 group-hover:opacity-100'
          }`}
        >
          <Star size={13} fill={project.isStarred ? 'currentColor' : 'none'} />
        </button>
      </div>
      {expanded && (
        <div className="mb-0.5 ml-[13px] border-l border-line/90">
          {sessions.map((session) => (
            <SessionLink
              key={session.id}
              session={session}
              active={activeSessionId === session.id}
              runningIds={runningIds}
              onOpen={() => onOpenSession(session)}
              onArchive={() => onArchiveSession(session.id)}
            />
          ))}
          {sessions.length === 0 && <p className="py-1 pl-3 text-sm text-fg-subtle">no chats yet</p>}
          {project.sessionMeta.total > sessions.length && (
            <button
              type="button"
              onClick={onSelect}
              className="flex w-full items-center rounded-md py-1.5 pl-3 text-sm text-fg-faint hover:bg-surface hover:text-fg-secondary"
            >
              all {project.sessionMeta.total} chats…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Lazy per-host archived-sessions list: fetched only when expanded (cold data,
 * deliberately outside the 12s fleet poll). Restore re-polls via the parent;
 * permanent delete is a two-step inline confirm — it removes the transcript
 * from the host's disk.
 */
function ArchivedSection({
  runtime,
  onRestore,
  onDeleteForever,
}: {
  runtime: HostRuntime
  onRestore: (sessionId: string) => Promise<void>
  onDeleteForever: (sessionId: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ArchivedSession[] | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const hostId = runtime.config.id

  const load = async () => {
    const token = getToken(hostId)
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      setItems(
        await getArchivedSessions(runtime.config.baseUrl, token, (t) => saveToken(hostId, t)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) void load()
  }

  const run = async (sessionId: string, action: () => Promise<void>) => {
    setBusyId(sessionId)
    setError(null)
    try {
      await action()
      setItems((prev) => prev?.filter((item) => item.sessionId !== sessionId) ?? prev)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyId(null)
      setConfirmId(null)
    }
  }

  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pl-2 pr-2 text-[13px] text-fg-subtle hover:bg-surface hover:text-fg-muted"
      >
        <Chevron size={12} className="shrink-0" />
        <Archive size={12} className="shrink-0" />
        Archived
        {open && items !== null && (
          <span className="tnum ml-auto font-mono text-[12px]">{items.length}</span>
        )}
      </button>
      {open && (
        <div className="mb-1">
          {loading && (
            <p className="flex items-center gap-2 py-1 pl-6 text-[13px] text-fg-subtle">
              <LoaderCircle size={12} className="animate-spin" /> loading…
            </p>
          )}
          {error && <p className="py-1 pl-6 pr-2 text-[13px] text-rose-400">{error}</p>}
          {!loading && items?.length === 0 && (
            <p className="py-1 pl-6 text-[13px] text-fg-subtle">nothing archived</p>
          )}
          {items?.map((item) => (
            <div
              key={item.sessionId}
              className="group/arch flex min-w-0 items-center gap-2 rounded-md py-1 pl-6 pr-1 text-[13px] text-fg-faint hover:bg-surface"
            >
              <div className="min-w-0 flex-1" title={item.sessionTitle}>
                <div className="truncate">{item.sessionTitle}</div>
                <div className="truncate font-mono text-[11px] text-fg-subtle">
                  {item.projectDisplayName}
                </div>
              </div>
              {busyId === item.sessionId ? (
                <LoaderCircle size={11} className="shrink-0 animate-spin text-fg-muted" />
              ) : confirmId === item.sessionId ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void run(item.sessionId, () => onDeleteForever(item.sessionId))}
                    title="Deletes the transcript from the host's disk"
                    className="rounded bg-rose-950/60 px-1.5 py-0.5 text-[12px] font-medium text-rose-400 hover:bg-rose-900/60"
                  >
                    delete forever?
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="rounded px-1 py-0.5 text-[12px] text-fg-faint hover:text-fg-secondary"
                  >
                    cancel
                  </button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/arch:opacity-100">
                  <button
                    type="button"
                    onClick={() => void run(item.sessionId, () => onRestore(item.sessionId))}
                    title="Restore"
                    className="rounded p-1 text-fg-faint hover:bg-elevated-strong hover:text-fg"
                  >
                    <ArchiveRestore size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(item.sessionId)}
                    title="Delete permanently"
                    className="rounded p-1 text-fg-subtle hover:bg-elevated-strong hover:text-rose-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HostSection({
  runtime,
  hostIndex,
  recent,
  view,
  creatingKey,
  onSelectProject,
  onOpenSession,
  onNewSession,
  onToggleStar,
  onArchiveSession,
  onRestoreSession,
  onDeleteSessionForever,
  onSignIn,
}: {
  runtime: HostRuntime
  hostIndex: number
  recent: Record<string, number>
  view: View
  creatingKey: string | null
  onSelectProject: (hostId: string, projectId: string) => void
  onOpenSession: (hostId: string, projectId: string, session: SessionSummary) => void
  onNewSession: (hostId: string, projectId: string) => void
  onToggleStar: (hostId: string, projectId: string) => void
  onArchiveSession: (hostId: string, sessionId: string) => void
  onRestoreSession: (hostId: string, sessionId: string) => Promise<void>
  onDeleteSessionForever: (hostId: string, sessionId: string) => Promise<void>
  onSignIn: (hostId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // Explicit user choices override the default (auto-open the active project's chats).
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})
  const color = hostColor(hostIndex)
  const hostId = runtime.config.id
  // The quick-create "+" follows the provider last picked in the project pane.
  const quickProvider = loadLastProvider(hostId) ?? 'claude'
  const newSessionTitle = `New ${
    PROVIDER_META[quickProvider as keyof typeof PROVIDER_META]?.label ?? quickProvider
  } session`

  // Projects with a currently-active session outrank everything — the user is
  // navigating to running agents far more often than to pinned archives.
  const activityRank = (project: Project) =>
    project.sessions.some((session) =>
      sessionLive(runtime.runningSessionIds, session.id, session.lastActivity),
    )
      ? 1
      : 0
  const sorted = [...runtime.projects].sort((a, b) => {
    const activeDelta = activityRank(b) - activityRank(a)
    if (activeDelta !== 0) return activeDelta
    if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1
    return recencyKey(b, hostId, recent) - recencyKey(a, hostId, recent)
  })
  const starredCount = sorted.filter((p) => p.isStarred).length
  // Always show pinned + recent; collapse the long tail.
  const alwaysVisible = Math.max(starredCount, COLLAPSED_COUNT)
  const visible = expanded ? sorted : sorted.slice(0, alwaysVisible)
  const hidden = sorted.length - visible.length

  const activeId =
    view.kind === 'project' || view.kind === 'files'
      ? view.hostId === hostId
        ? view.projectId
        : null
      : null
  const activeChat = view.kind === 'chat' && view.target.hostId === hostId ? view.target : null
  const dimmed = runtime.status !== 'online'

  return (
    <div className="mb-1">
      <div
        className={`flex items-center gap-2 px-2 py-1.5 text-sm font-medium ${
          runtime.status === 'online' ? 'text-fg-secondary' : 'text-fg-faint'
        }`}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="min-w-0 flex-1 truncate">{runtime.config.name}</span>
        <HostStatusHint runtime={runtime} onSignIn={onSignIn} />
      </div>
      {visible.map((project) => {
        const hasActiveChat = activeChat?.projectPath === project.fullPath
        const isOpen =
          openOverrides[project.projectId] ??
          (hasActiveChat || activeId === project.projectId)
        return (
          <ProjectRow
            key={project.projectId}
            project={project}
            active={activeId === project.projectId || hasActiveChat}
            activeSessionId={hasActiveChat ? activeChat.session.id : null}
            dimmed={dimmed}
            expanded={isOpen}
            creating={creatingKey === `${hostId}:${project.projectId}`}
            canCreate={runtime.status === 'online'}
            newSessionTitle={newSessionTitle}
            runningIds={runtime.runningSessionIds}
            onToggleExpand={() =>
              setOpenOverrides((prev) => ({ ...prev, [project.projectId]: !isOpen }))
            }
            onSelect={() => onSelectProject(hostId, project.projectId)}
            onOpenSession={(session) => onOpenSession(hostId, project.projectId, session)}
            onNewSession={() => onNewSession(hostId, project.projectId)}
            onToggleStar={() => onToggleStar(hostId, project.projectId)}
            onArchiveSession={(sessionId) => onArchiveSession(hostId, sessionId)}
          />
        )
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-1 rounded-md py-1.5 pl-2 text-sm text-fg-faint hover:bg-surface hover:text-fg-secondary"
        >
          <ChevronDown size={13} /> {hidden} more
        </button>
      )}
      {expanded && sorted.length > alwaysVisible && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex w-full items-center gap-1 rounded-md py-1.5 pl-2 text-sm text-fg-faint hover:bg-surface hover:text-fg-secondary"
        >
          <ChevronDown size={13} className="rotate-180" /> Show less
        </button>
      )}
      {runtime.status === 'online' && runtime.projects.length === 0 && (
        <p className="py-1 pl-2 text-sm text-fg-subtle">no projects</p>
      )}
      {runtime.status === 'online' && (
        <ArchivedSection
          runtime={runtime}
          onRestore={(sessionId) => onRestoreSession(hostId, sessionId)}
          onDeleteForever={(sessionId) => onDeleteSessionForever(hostId, sessionId)}
        />
      )}
    </div>
  )
}

export function Sidebar({
  hosts,
  recent,
  view,
  onSelectFeed,
  onSelectProject,
  onOpenSession,
  onNewSession,
  creatingKey,
  onToggleStar,
  onArchiveSession,
  onRestoreSession,
  onDeleteSessionForever,
  onSignIn,
  onOpenSettings,
  onOpenSearch,
  onRefresh,
  onOpenBacklog,
}: Props) {
  const [width, setWidth] = useState(() => loadSidebarWidth())
  const widthRef = useRef(width)
  widthRef.current = width

  const liveCount = hosts.reduce(
    (count, runtime) =>
      count +
      runtime.projects.reduce(
        (sum, project) =>
          sum +
          project.sessions.filter((session) =>
            sessionLive(runtime.runningSessionIds, session.id, session.lastActivity),
          ).length,
        0,
      ),
    0,
  )

  function startResize(event: React.PointerEvent) {
    event.preventDefault()
    const onMove = (move: PointerEvent) => {
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, move.clientX))
      widthRef.current = next
      setWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      saveSidebarWidth(widthRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-line/80 bg-canvas"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="font-display flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-wide">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${
              liveCount > 0
                ? 'animate-pulse bg-accent shadow-[0_0_8px_rgba(227,180,76,0.7)]'
                : 'bg-elevated-strong'
            }`}
          />
          <span className="truncate">Agents Hub</span>
          {liveCount > 0 && (
            <span
              title={`${liveCount} agent${liveCount === 1 ? '' : 's'} running`}
              className="tnum shrink-0 rounded-full border border-accent/30 bg-accent/10 px-1.5 py-px font-mono text-[11px] font-medium text-accent-strong"
            >
              {liveCount} live
            </span>
          )}
        </h1>
        <div className="flex gap-0.5">
          {import.meta.env.DEV && onOpenBacklog && (
            <button
              type="button"
              onClick={onOpenBacklog}
              title="Backlog (dev)"
              className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-elevated hover:text-fg"
            >
              <ListChecks size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSearch}
            title="Search conversations (⌘K)"
            className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-elevated hover:text-fg"
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh now"
            className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-elevated hover:text-fg"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="Settings"
            className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-elevated hover:text-fg"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <button
          type="button"
          onClick={onSelectFeed}
          className={`mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[15px] transition-colors ${
            view.kind === 'feed' ? 'bg-elevated text-fg' : 'text-fg-muted hover:bg-surface'
          }`}
        >
          <Inbox size={15} className="shrink-0" />
          All sessions
        </button>

        {hosts.map((runtime, hostIndex) => (
          <HostSection
            key={runtime.config.id}
            runtime={runtime}
            hostIndex={hostIndex}
            recent={recent}
            view={view}
            creatingKey={creatingKey}
            onSelectProject={onSelectProject}
            onOpenSession={onOpenSession}
            onNewSession={onNewSession}
            onToggleStar={onToggleStar}
            onArchiveSession={onArchiveSession}
            onRestoreSession={onRestoreSession}
            onDeleteSessionForever={onDeleteSessionForever}
            onSignIn={onSignIn}
          />
        ))}
      </nav>

      <div
        onPointerDown={startResize}
        title="Drag to resize"
        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize transition-colors hover:bg-elevated-strong/50"
      />
    </aside>
  )
}

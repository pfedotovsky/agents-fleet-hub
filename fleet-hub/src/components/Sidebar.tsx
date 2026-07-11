import { useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Inbox,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  MoonStar,
  Plus,
  RefreshCw,
  Settings,
  Star,
  UserPlus,
} from 'lucide-react'
import type { HostRuntime, Project, SessionSummary } from '../types'
import type { View } from '../App'
import { hostColor, isActive, relativeTime } from '../lib/format'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  loadSidebarWidth,
  saveSidebarWidth,
} from '../lib/storage'

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
  onSignIn: (hostId: string) => void
  onOpenSettings: () => void
  onRefresh: () => void
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
      return <LoaderCircle size={12} className="animate-spin text-ink-600" />
    case 'offline':
      return (
        <span title="Offline — wake the VM and run HOST=:: cloudcli">
          <MoonStar size={12} className="text-ink-600" />
        </span>
      )
    case 'needs-auth':
      return (
        <button
          type="button"
          onClick={() => onSignIn(runtime.config.id)}
          title={`Sign in to ${runtime.config.name}`}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-amber-400 hover:bg-ink-800"
        >
          <KeyRound size={11} /> sign in
        </button>
      )
    case 'needs-setup':
      return (
        <button
          type="button"
          onClick={() => onSignIn(runtime.config.id)}
          title={`Create the first account on ${runtime.config.name}`}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-sky-400 hover:bg-ink-800"
        >
          <UserPlus size={11} /> set up
        </button>
      )
    default:
      return null
  }
}

function SessionLink({
  session,
  active,
  onOpen,
}: {
  session: SessionSummary
  active: boolean
  onOpen: () => void
}) {
  const title = session.summary || 'Untitled session'
  const running = isActive(session.lastActivity)
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className={`flex w-full min-w-0 items-center gap-2 rounded-md py-1 pl-10 pr-2 text-xs transition-colors ${
        active ? 'bg-ink-800 text-ink-100' : 'text-ink-500 hover:bg-ink-900 hover:text-ink-300'
      }`}
    >
      <MessageSquare size={11} className="shrink-0 text-ink-600" />
      <span className="min-w-0 flex-1 truncate text-left">{title}</span>
      {running ? (
        <span
          title="Active in the last 2 minutes"
          className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-400"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          active
        </span>
      ) : (
        <span className="tnum shrink-0 font-mono text-[10px] text-ink-700">
          {relativeTime(session.lastActivity)}
        </span>
      )}
    </button>
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
  onToggleExpand,
  onSelect,
  onOpenSession,
  onNewSession,
  onToggleStar,
}: {
  project: Project
  active: boolean
  activeSessionId: string | null
  dimmed: boolean
  expanded: boolean
  creating: boolean
  canCreate: boolean
  onToggleExpand: () => void
  onSelect: () => void
  onOpenSession: (session: SessionSummary) => void
  onNewSession: () => void
  onToggleStar: () => void
}) {
  const sessions = expanded
    ? [...project.sessions]
        .sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity))
        .slice(0, SESSIONS_PER_PROJECT)
    : []
  const hasActivity = project.sessions.some((session) => isActive(session.lastActivity))
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <div className={dimmed ? 'opacity-60' : ''}>
      <div
        className={`group flex items-center rounded-md pr-1 transition-colors ${
          active ? 'bg-ink-800' : 'hover:bg-ink-900'
        }`}
      >
        <button
          type="button"
          onClick={onToggleExpand}
          title={expanded ? 'Hide chats' : 'Show chats'}
          className="shrink-0 rounded p-0.5 pl-1.5 text-ink-600 hover:text-ink-300"
        >
          <Chevron size={12} />
        </button>
        <button
          type="button"
          onClick={onSelect}
          title={project.fullPath}
          className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 text-sm ${
            active ? 'text-ink-100' : 'text-ink-400'
          }`}
        >
          <Folder size={13} className="shrink-0 text-ink-600" />
          <span className="min-w-0 flex-1 truncate text-left">{project.displayName}</span>
          {hasActivity && (
            <span
              title="Has a session active in the last 2 minutes"
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400"
            />
          )}
          <span className="tnum shrink-0 font-mono text-[10px] text-ink-600">
            {project.sessionMeta.total}
          </span>
        </button>
        {canCreate && (
          <button
            type="button"
            onClick={onNewSession}
            disabled={creating}
            title="New session"
            className={`shrink-0 rounded p-1 text-ink-600 transition-opacity hover:bg-ink-700 hover:text-ink-200 ${
              creating ? '' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            {creating ? (
              <LoaderCircle size={12} className="animate-spin text-ink-400" />
            ) : (
              <Plus size={12} />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleStar}
          title={project.isStarred ? 'Unpin' : 'Pin'}
          className={`shrink-0 rounded p-1 transition-opacity hover:bg-ink-700 ${
            project.isStarred ? 'text-amber-400' : 'text-ink-600 opacity-0 group-hover:opacity-100'
          }`}
        >
          <Star size={12} fill={project.isStarred ? 'currentColor' : 'none'} />
        </button>
      </div>
      {expanded && (
        <div className="mb-0.5">
          {sessions.map((session) => (
            <SessionLink
              key={session.id}
              session={session}
              active={activeSessionId === session.id}
              onOpen={() => onOpenSession(session)}
            />
          ))}
          {sessions.length === 0 && <p className="py-1 pl-10 text-xs text-ink-700">no chats yet</p>}
          {project.sessionMeta.total > sessions.length && (
            <button
              type="button"
              onClick={onSelect}
              className="flex w-full items-center rounded-md py-1 pl-10 text-xs text-ink-600 hover:bg-ink-900 hover:text-ink-400"
            >
              all {project.sessionMeta.total} chats…
            </button>
          )}
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
  onSignIn: (hostId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // Explicit user choices override the default (auto-open the active project's chats).
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})
  const color = hostColor(hostIndex)
  const hostId = runtime.config.id

  // Projects with a currently-active session outrank everything — the user is
  // navigating to running agents far more often than to pinned archives.
  const activityRank = (project: Project) =>
    project.sessions.some((session) => isActive(session.lastActivity)) ? 1 : 0
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
        className={`flex items-center gap-2 px-2 py-1.5 text-xs font-medium ${
          runtime.status === 'online' ? 'text-ink-300' : 'text-ink-500'
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
            onToggleExpand={() =>
              setOpenOverrides((prev) => ({ ...prev, [project.projectId]: !isOpen }))
            }
            onSelect={() => onSelectProject(hostId, project.projectId)}
            onOpenSession={(session) => onOpenSession(hostId, project.projectId, session)}
            onNewSession={() => onNewSession(hostId, project.projectId)}
            onToggleStar={() => onToggleStar(hostId, project.projectId)}
          />
        )
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-1 rounded-md py-1 pl-5 text-xs text-ink-600 hover:bg-ink-900 hover:text-ink-400"
        >
          <ChevronDown size={12} /> {hidden} more
        </button>
      )}
      {expanded && sorted.length > alwaysVisible && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex w-full items-center gap-1 rounded-md py-1 pl-5 text-xs text-ink-600 hover:bg-ink-900 hover:text-ink-400"
        >
          <ChevronDown size={12} className="rotate-180" /> Show less
        </button>
      )}
      {runtime.status === 'online' && runtime.projects.length === 0 && (
        <p className="py-1 pl-5 text-xs text-ink-700">no projects</p>
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
  onSignIn,
  onOpenSettings,
  onRefresh,
}: Props) {
  const [width, setWidth] = useState(() => loadSidebarWidth())
  const widthRef = useRef(width)
  widthRef.current = width

  const liveCount = hosts.reduce(
    (count, runtime) =>
      count +
      runtime.projects.reduce(
        (sum, project) =>
          sum + project.sessions.filter((session) => isActive(session.lastActivity)).length,
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
      className="relative flex h-full shrink-0 flex-col border-r border-ink-800/80 bg-ink-950"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="font-display flex min-w-0 items-center gap-2 text-sm font-semibold tracking-wide">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${
              liveCount > 0
                ? 'animate-pulse bg-brass-400 shadow-[0_0_8px_rgba(227,180,76,0.7)]'
                : 'bg-ink-600'
            }`}
          />
          <span className="truncate">Agents Hub</span>
          {liveCount > 0 && (
            <span
              title={`${liveCount} agent${liveCount === 1 ? '' : 's'} active in the last 2 minutes`}
              className="tnum shrink-0 rounded-full border border-brass-400/30 bg-brass-400/10 px-1.5 py-px font-mono text-[10px] font-medium text-brass-300"
            >
              {liveCount} live
            </span>
          )}
        </h1>
        <div className="flex gap-0.5">
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh now"
            className="rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-200"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="Settings"
            className="rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-200"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <button
          type="button"
          onClick={onSelectFeed}
          className={`mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
            view.kind === 'feed' ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:bg-ink-900'
          }`}
        >
          <Inbox size={14} className="shrink-0" />
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
            onSignIn={onSignIn}
          />
        ))}
      </nav>

      <div
        onPointerDown={startResize}
        title="Drag to resize"
        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize transition-colors hover:bg-ink-700/50"
      />
    </aside>
  )
}

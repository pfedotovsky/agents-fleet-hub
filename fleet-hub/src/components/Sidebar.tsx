import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Inbox,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  MoonStar,
  RefreshCw,
  Settings,
  Star,
  UserPlus,
} from 'lucide-react'
import type { HostRuntime, Project, SessionSummary } from '../types'
import type { View } from '../App'
import { hostColor, relativeTime } from '../lib/format'

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
      return <LoaderCircle size={12} className="animate-spin text-zinc-600" />
    case 'offline':
      return (
        <span title="Offline — wake the VM and run HOST=:: cloudcli">
          <MoonStar size={12} className="text-zinc-600" />
        </span>
      )
    case 'needs-auth':
      return (
        <button
          type="button"
          onClick={() => onSignIn(runtime.config.id)}
          title={`Sign in to ${runtime.config.name}`}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-amber-400 hover:bg-zinc-800"
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
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-sky-400 hover:bg-zinc-800"
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
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className={`flex w-full min-w-0 items-center gap-2 rounded-md py-1 pl-10 pr-2 text-xs transition-colors ${
        active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'
      }`}
    >
      <MessageSquare size={11} className="shrink-0 text-zinc-600" />
      <span className="min-w-0 flex-1 truncate text-left">{title}</span>
      <span className="tnum shrink-0 font-mono text-[10px] text-zinc-700">
        {relativeTime(session.lastActivity)}
      </span>
    </button>
  )
}

function ProjectRow({
  project,
  active,
  activeSessionId,
  dimmed,
  expanded,
  onToggleExpand,
  onSelect,
  onOpenSession,
  onToggleStar,
}: {
  project: Project
  active: boolean
  activeSessionId: string | null
  dimmed: boolean
  expanded: boolean
  onToggleExpand: () => void
  onSelect: () => void
  onOpenSession: (session: SessionSummary) => void
  onToggleStar: () => void
}) {
  const sessions = expanded
    ? [...project.sessions]
        .sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity))
        .slice(0, SESSIONS_PER_PROJECT)
    : []
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <div className={dimmed ? 'opacity-60' : ''}>
      <div
        className={`group flex items-center rounded-md pr-1 transition-colors ${
          active ? 'bg-zinc-800' : 'hover:bg-zinc-900'
        }`}
      >
        <button
          type="button"
          onClick={onToggleExpand}
          title={expanded ? 'Hide chats' : 'Show chats'}
          className="shrink-0 rounded p-0.5 pl-1.5 text-zinc-600 hover:text-zinc-300"
        >
          <Chevron size={12} />
        </button>
        <button
          type="button"
          onClick={onSelect}
          title={project.fullPath}
          className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 text-sm ${
            active ? 'text-zinc-100' : 'text-zinc-400'
          }`}
        >
          <Folder size={13} className="shrink-0 text-zinc-600" />
          <span className="min-w-0 flex-1 truncate text-left">{project.displayName}</span>
          <span className="tnum shrink-0 font-mono text-[10px] text-zinc-600">
            {project.sessionMeta.total}
          </span>
        </button>
        <button
          type="button"
          onClick={onToggleStar}
          title={project.isStarred ? 'Unpin' : 'Pin'}
          className={`shrink-0 rounded p-1 transition-opacity hover:bg-zinc-700 ${
            project.isStarred ? 'text-amber-400' : 'text-zinc-600 opacity-0 group-hover:opacity-100'
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
          {sessions.length === 0 && <p className="py-1 pl-10 text-xs text-zinc-700">no chats yet</p>}
          {project.sessionMeta.total > sessions.length && (
            <button
              type="button"
              onClick={onSelect}
              className="flex w-full items-center rounded-md py-1 pl-10 text-xs text-zinc-600 hover:bg-zinc-900 hover:text-zinc-400"
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
  onSelectProject,
  onOpenSession,
  onToggleStar,
  onSignIn,
}: {
  runtime: HostRuntime
  hostIndex: number
  recent: Record<string, number>
  view: View
  onSelectProject: (hostId: string, projectId: string) => void
  onOpenSession: (hostId: string, projectId: string, session: SessionSummary) => void
  onToggleStar: (hostId: string, projectId: string) => void
  onSignIn: (hostId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // Explicit user choices override the default (auto-open the active project's chats).
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})
  const color = hostColor(hostIndex)
  const hostId = runtime.config.id

  const sorted = [...runtime.projects].sort((a, b) => {
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
          runtime.status === 'online' ? 'text-zinc-300' : 'text-zinc-500'
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
            onToggleExpand={() =>
              setOpenOverrides((prev) => ({ ...prev, [project.projectId]: !isOpen }))
            }
            onSelect={() => onSelectProject(hostId, project.projectId)}
            onOpenSession={(session) => onOpenSession(hostId, project.projectId, session)}
            onToggleStar={() => onToggleStar(hostId, project.projectId)}
          />
        )
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-1 rounded-md py-1 pl-5 text-xs text-zinc-600 hover:bg-zinc-900 hover:text-zinc-400"
        >
          <ChevronDown size={12} /> {hidden} more
        </button>
      )}
      {expanded && sorted.length > alwaysVisible && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex w-full items-center gap-1 rounded-md py-1 pl-5 text-xs text-zinc-600 hover:bg-zinc-900 hover:text-zinc-400"
        >
          <ChevronDown size={12} className="rotate-180" /> Show less
        </button>
      )}
      {runtime.status === 'online' && runtime.projects.length === 0 && (
        <p className="py-1 pl-5 text-xs text-zinc-700">no projects</p>
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
  onToggleStar,
  onSignIn,
  onOpenSettings,
  onRefresh,
}: Props) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-sm font-semibold tracking-wide">Fleet Hub</h1>
        <div className="flex gap-0.5">
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh now"
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="Settings"
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
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
            view.kind === 'feed' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'
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
            onSelectProject={onSelectProject}
            onOpenSession={onOpenSession}
            onToggleStar={onToggleStar}
            onSignIn={onSignIn}
          />
        ))}
      </nav>
    </aside>
  )
}

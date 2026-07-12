import { useEffect, useState } from 'react'
import { Server, X } from 'lucide-react'
import type { FleetSession, SessionSummary } from './types'
import { createSession } from './lib/api'
import { getToken, saveToken } from './lib/storage'
import { useFleet } from './hooks/useFleet'
import { Sidebar } from './components/Sidebar'
import { SessionList } from './components/SessionList'
import { ChatPane } from './components/ChatPane'
import { ProjectPane } from './components/ProjectPane'
import { FileBrowser } from './components/FileBrowser'
import { GitPanel } from './components/GitPanel'
import { OfflineCard } from './components/OfflineCard'
import { LoginModal } from './components/LoginModal'
import { SettingsPanel } from './components/SettingsPanel'
import { SearchOverlay } from './components/SearchOverlay'

export type View =
  | { kind: 'feed' }
  | { kind: 'project'; hostId: string; projectId: string }
  | { kind: 'files'; hostId: string; projectId: string }
  | { kind: 'git'; hostId: string; projectId: string }
  | { kind: 'chat'; target: FleetSession; from: View }

export default function App() {
  const fleet = useFleet()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [loginHostId, setLoginHostId] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'feed' })
  const [creatingKey, setCreatingKey] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const loginRuntime = fleet.hosts.find((runtime) => runtime.config.id === loginHostId)
  const downHosts = fleet.hosts.filter(
    (runtime) => runtime.status === 'offline' || runtime.status === 'needs-setup',
  )

  const openChat = (target: FleetSession) => {
    fleet.markProjectOpened(target.hostId, target.session.id)
    setView((current) => ({ kind: 'chat', target, from: current.kind === 'chat' ? current.from : current }))
  }

  const openProject = (hostId: string, projectId: string) => {
    fleet.markProjectOpened(hostId, projectId)
    setView({ kind: 'project', hostId, projectId })
  }

  /** Archives a session and closes its chat if it's the one on screen. */
  const archiveSession = (hostId: string, sessionId: string) => {
    void fleet.archiveSession(hostId, sessionId)
    setView((current) =>
      current.kind === 'chat' &&
      current.target.hostId === hostId &&
      current.target.session.id === sessionId
        ? current.from
        : current,
    )
  }

  const openSessionFromSidebar = (hostId: string, projectId: string, session: SessionSummary) => {
    const { hostIndex, runtime, project } = findProject(hostId, projectId)
    if (!runtime || !project) return
    openChat({
      key: `${hostId}:${session.id}`,
      hostId,
      hostName: runtime.config.name,
      hostColorIdx: hostIndex,
      baseUrl: runtime.config.baseUrl,
      projectName: project.displayName,
      projectPath: project.fullPath,
      projectId: project.projectId,
      session,
      href: `${runtime.config.baseUrl}/session/${session.id}`,
      stale: runtime.status !== 'online',
      justUpdated: false,
    })
  }

  /** One-click "new session" from the sidebar: create on the host, jump straight into the chat. */
  const newSession = async (hostId: string, projectId: string) => {
    const { hostIndex, runtime, project } = findProject(hostId, projectId)
    if (!runtime || !project) return
    const key = `${hostId}:${projectId}`
    setCreatingKey(key)
    setCreateError(null)
    try {
      const token = getToken(hostId)
      if (!token) throw new Error(`Not signed in to ${runtime.config.name}`)
      const created = await createSession(
        runtime.config.baseUrl,
        token,
        'claude',
        project.fullPath,
        (refreshed) => saveToken(hostId, refreshed),
      )
      openChat({
        key: `${hostId}:${created.sessionId}`,
        hostId,
        hostName: runtime.config.name,
        hostColorIdx: hostIndex,
        baseUrl: runtime.config.baseUrl,
        projectName: project.displayName,
        projectPath: project.fullPath,
        projectId: project.projectId,
        session: {
          id: created.sessionId,
          provider: created.provider,
          summary: '',
          messageCount: 0,
          lastActivity: new Date().toISOString(),
        },
        href: `${runtime.config.baseUrl}/session/${created.sessionId}`,
        stale: false,
        justUpdated: false,
      })
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create a session')
    } finally {
      setCreatingKey(null)
    }
  }

  function findProject(hostId: string, projectId: string) {
    const hostIndex = fleet.hosts.findIndex((runtime) => runtime.config.id === hostId)
    const runtime = hostIndex >= 0 ? fleet.hosts[hostIndex] : undefined
    const project = runtime?.projects.find((p) => p.projectId === projectId)
    return { hostIndex, runtime, project }
  }

  function renderMain() {
    if (fleet.hosts.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Server size={32} className="text-ink-700" />
          <div>
            <h2 className="font-display text-base font-semibold text-ink-200">No hosts configured</h2>
            <p className="mt-1 max-w-sm text-sm text-ink-500">
              Add your CloudCLI instances — remote VMs or localhost — and their projects and
              sessions will appear here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-md bg-brass-400 px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-brass-300"
          >
            Add your first host
          </button>
        </div>
      )
    }
    if (view.kind === 'chat') {
      return <ChatPane key={view.target.key} target={view.target} onBack={() => setView(view.from)} />
    }
    if (view.kind === 'files' || view.kind === 'git') {
      const { hostIndex, runtime, project } = findProject(view.hostId, view.projectId)
      if (!runtime || !project) {
        return (
          <p className="flex flex-1 items-center justify-center text-sm text-ink-500">
            This project is no longer available.
          </p>
        )
      }
      const Pane = view.kind === 'files' ? FileBrowser : GitPanel
      return (
        <Pane
          key={`${view.kind}:${view.hostId}:${view.projectId}`}
          runtime={runtime}
          hostColorIdx={hostIndex}
          project={project}
          onBack={() => setView({ kind: 'project', hostId: view.hostId, projectId: view.projectId })}
        />
      )
    }
    if (view.kind === 'project') {
      const { hostIndex, runtime, project } = findProject(view.hostId, view.projectId)
      if (!runtime || !project) {
        return (
          <p className="flex flex-1 items-center justify-center text-sm text-ink-500">
            This project is no longer available.
          </p>
        )
      }
      return (
        <ProjectPane
          key={`${view.hostId}:${view.projectId}`}
          runtime={runtime}
          hostColorIdx={hostIndex}
          project={project}
          onOpenSession={openChat}
          onOpenFiles={() => setView({ kind: 'files', hostId: view.hostId, projectId: view.projectId })}
          onOpenGit={() => setView({ kind: 'git', hostId: view.hostId, projectId: view.projectId })}
          onArchiveSession={(sessionId) => archiveSession(view.hostId, sessionId)}
        />
      )
    }
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6">
          <h2 className="font-display mb-1 text-sm font-semibold text-ink-300">All sessions</h2>
          {downHosts.map((runtime) => (
            <OfflineCard
              key={runtime.config.id}
              runtime={runtime}
              onSetup={() => setLoginHostId(runtime.config.id)}
            />
          ))}
          <SessionList
            sessions={fleet.sessions}
            hosts={fleet.hosts}
            onOpen={openChat}
            onArchive={(item) => archiveSession(item.hostId, item.session.id)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        hosts={fleet.hosts}
        recent={fleet.recent}
        view={view}
        onSelectFeed={() => setView({ kind: 'feed' })}
        onSelectProject={openProject}
        onOpenSession={openSessionFromSidebar}
        onNewSession={(hostId, projectId) => void newSession(hostId, projectId)}
        creatingKey={creatingKey}
        onToggleStar={(hostId, projectId) => void fleet.toggleStar(hostId, projectId)}
        onArchiveSession={archiveSession}
        onRestoreSession={fleet.restoreSession}
        onDeleteSessionForever={fleet.deleteSessionForever}
        onSignIn={setLoginHostId}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onRefresh={fleet.refresh}
      />
      <main className="flex min-w-0 flex-1 flex-col">{renderMain()}</main>
      {createError && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border border-rose-900/60 bg-ink-900 px-3 py-2 text-xs text-rose-400 shadow-lg">
          <span>{createError}</span>
          <button
            type="button"
            onClick={() => setCreateError(null)}
            className="rounded p-0.5 text-ink-500 hover:text-ink-200"
          >
            <X size={12} />
          </button>
        </div>
      )}
      {searchOpen && (
        <SearchOverlay
          hosts={fleet.hosts}
          onOpenSession={openChat}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          hosts={fleet.hosts}
          prefs={fleet.prefs}
          onAddHost={fleet.addHost}
          onRemoveHost={fleet.removeHost}
          onUpdatePrefs={fleet.updatePrefs}
          onClearTokens={fleet.clearTokens}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {loginRuntime && (
        <LoginModal
          runtime={loginRuntime}
          onSubmit={(username, password) =>
            fleet.loginHost(
              loginRuntime.config.id,
              username,
              password,
              loginRuntime.status === 'needs-setup' ? 'setup' : 'login',
            )
          }
          onClose={() => setLoginHostId(null)}
        />
      )}
    </div>
  )
}

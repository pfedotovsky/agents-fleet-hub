import { useState } from 'react'
import { Server } from 'lucide-react'
import type { FleetSession, SessionSummary } from './types'
import { useFleet } from './hooks/useFleet'
import { Sidebar } from './components/Sidebar'
import { SessionList } from './components/SessionList'
import { ChatPane } from './components/ChatPane'
import { ProjectPane } from './components/ProjectPane'
import { FileBrowser } from './components/FileBrowser'
import { OfflineCard } from './components/OfflineCard'
import { LoginModal } from './components/LoginModal'
import { SettingsPanel } from './components/SettingsPanel'

export type View =
  | { kind: 'feed' }
  | { kind: 'project'; hostId: string; projectId: string }
  | { kind: 'files'; hostId: string; projectId: string }
  | { kind: 'chat'; target: FleetSession; from: View }

export default function App() {
  const fleet = useFleet()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loginHostId, setLoginHostId] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'feed' })

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
      session,
      href: `${runtime.config.baseUrl}/session/${session.id}`,
      stale: runtime.status !== 'online',
      justUpdated: false,
    })
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
          <Server size={32} className="text-zinc-700" />
          <div>
            <h2 className="text-base font-semibold text-zinc-200">No hosts configured</h2>
            <p className="mt-1 max-w-sm text-sm text-zinc-500">
              Add your CloudCLI instances — remote VMs or localhost — and their projects and
              sessions will appear here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
          >
            Add your first host
          </button>
        </div>
      )
    }
    if (view.kind === 'chat') {
      return <ChatPane key={view.target.key} target={view.target} onBack={() => setView(view.from)} />
    }
    if (view.kind === 'files') {
      const { hostIndex, runtime, project } = findProject(view.hostId, view.projectId)
      if (!runtime || !project) {
        return (
          <p className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            This project is no longer available.
          </p>
        )
      }
      return (
        <FileBrowser
          key={`files:${view.hostId}:${view.projectId}`}
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
          <p className="flex flex-1 items-center justify-center text-sm text-zinc-500">
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
        />
      )
    }
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6">
          <h2 className="mb-1 text-sm font-semibold text-zinc-300">All sessions</h2>
          {downHosts.map((runtime) => (
            <OfflineCard
              key={runtime.config.id}
              runtime={runtime}
              onSetup={() => setLoginHostId(runtime.config.id)}
            />
          ))}
          <SessionList sessions={fleet.sessions} hosts={fleet.hosts} onOpen={openChat} />
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
        onToggleStar={(hostId, projectId) => void fleet.toggleStar(hostId, projectId)}
        onSignIn={setLoginHostId}
        onOpenSettings={() => setSettingsOpen(true)}
        onRefresh={fleet.refresh}
      />
      <main className="flex min-w-0 flex-1 flex-col">{renderMain()}</main>
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

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, Server, X } from 'lucide-react'
import type {
  FleetSession,
  HostRuntime,
  Project,
  Provider,
  SessionSummary,
  SessionView,
} from './types'
import { EASE_OUT } from './lib/motion'
import type { ChatPanelKind } from './lib/storage'
import {
  CHAT_PANEL_MIN_WIDTH,
  loadChatPanel,
  loadLastProvider,
  saveChatPanel,
} from './lib/storage'
import { useFleet } from './hooks/useFleet'
import { useTheme } from './hooks/useTheme'
import { parseSessionHash, sessionHash, type SessionLink } from './lib/deepLink'
import { getSessionById } from './lib/api'
import { getToken, saveToken } from './lib/storage'
import { Sidebar } from './components/Sidebar'
import { SessionList } from './components/SessionList'
import { ChatPane } from './components/ChatPane'
import { ProjectPane } from './components/ProjectPane'
import { FileBrowser } from './components/FileBrowser'
import { GitPanel } from './components/GitPanel'
import { TerminalPanel } from './components/TerminalPanel'
import { OfflineCard } from './components/OfflineCard'
import { LoginModal } from './components/LoginModal'
import { SettingsPanel } from './components/SettingsPanel'
import { SearchOverlay } from './components/SearchOverlay'

export type View =
  | { kind: 'feed' }
  | { kind: 'project'; hostId: string; projectId: string }
  | { kind: 'files'; hostId: string; projectId: string }
  | { kind: 'git'; hostId: string; projectId: string }
  | { kind: 'chat'; target: FleetSession; from: View; sessionView: SessionView }

export default function App() {
  const fleet = useFleet()
  const [theme, setTheme] = useTheme()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [loginHostId, setLoginHostId] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'feed' })
  // A session deep-link (#/s/host/project/session) parsed from the URL, held
  // until the target host finishes loading so we can rebuild the full
  // FleetSession. Seeded on first render before any effect can clear the hash.
  const [linkRequest, setLinkRequest] = useState<SessionLink | null>(() =>
    parseSessionHash(window.location.hash),
  )
  // Set true right before we write the hash ourselves, so the hashchange
  // listener ignores our own writes instead of treating them as a new link.
  const applyingHashRef = useRef(false)
  // Session creation is now deferred to the first send, so the sidebar spinner
  // key stays null — kept for the Sidebar prop contract.
  const [creatingKey] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  // Cursor-style utility panel docked to the right of a chat.
  const [chatPanel, setChatPanel] = useState<ChatPanelKind | null>(() => loadChatPanel().kind)
  const [chatPanelWidth, setChatPanelWidth] = useState(() => loadChatPanel().width)
  const chatPanelWidthRef = useRef(chatPanelWidth)
  chatPanelWidthRef.current = chatPanelWidth
  const toggleChatPanel = (panel: ChatPanelKind) => {
    setChatPanel((current) => {
      const next = current === panel ? null : panel
      saveChatPanel({ kind: next, width: chatPanelWidthRef.current })
      return next
    })
  }

  function startChatPanelResize(event: React.PointerEvent) {
    event.preventDefault()
    const onMove = (move: PointerEvent) => {
      const max = Math.max(CHAT_PANEL_MIN_WIDTH, window.innerWidth * 0.7)
      const next = Math.min(max, Math.max(CHAT_PANEL_MIN_WIDTH, window.innerWidth - move.clientX))
      chatPanelWidthRef.current = next
      setChatPanelWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      saveChatPanel({ kind: chatPanel, width: chatPanelWidthRef.current })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

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
    setView((current) => ({
      kind: 'chat',
      target,
      from: current.kind === 'chat' ? current.from : current,
      sessionView: fleet.prefs.defaultSessionView,
    }))
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

  /** Renames a session and keeps an already-open chat header in sync. */
  const renameSession = async (hostId: string, sessionId: string, summary: string) => {
    await fleet.renameSession(hostId, sessionId, summary)
    setView((current) =>
      current.kind === 'chat' &&
      current.target.hostId === hostId &&
      current.target.session.id === sessionId
        ? {
            ...current,
            target: {
              ...current.target,
              session: { ...current.target.session, summary },
            },
          }
        : current,
    )
  }

  /** Renames a project and keeps an already-open chat or draft label in sync. */
  const renameProject = async (hostId: string, projectId: string, displayName: string) => {
    const resolvedName = await fleet.renameProject(hostId, projectId, displayName)
    setView((current) =>
      current.kind === 'chat' &&
      current.target.hostId === hostId &&
      current.target.projectId === projectId
        ? { ...current, target: { ...current.target, projectName: resolvedName } }
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

  /**
   * "New session" from the sidebar: open a draft chat immediately. The real
   * session is created on the first send, with the provider chosen in the
   * composer toggle (seeded from the last-picked provider).
   */
  const newSession = (hostId: string, projectId: string) => {
    const { hostIndex, runtime, project } = findProject(hostId, projectId)
    if (!runtime || !project) return
    const last = loadLastProvider(hostId)
    const provider: Provider =
      last === 'claude' || last === 'codex' || last === 'opencode' ? last : 'claude'
    openChat({
      // A stable, per-project draft key so React never remounts the pane when
      // the first send swaps the empty id for the real one.
      key: `${hostId}::draft:${projectId}`,
      hostId,
      hostName: runtime.config.name,
      hostColorIdx: hostIndex,
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
    })
  }

  function draftTargetFor(runtime: HostRuntime, hostIndex: number, project: Project): FleetSession {
    const last = loadLastProvider(runtime.config.id)
    const provider: Provider =
      last === 'claude' || last === 'codex' || last === 'opencode' ? last : 'claude'
    return {
      key: `${runtime.config.id}::draft:${project.projectId}`,
      hostId: runtime.config.id,
      hostName: runtime.config.name,
      hostColorIdx: hostIndex,
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
      stale: false,
      justUpdated: false,
    }
  }

  const draftTargets = fleet.hosts.flatMap((runtime, hostIndex) =>
    runtime.status === 'online'
      ? runtime.projects.map((project) => draftTargetFor(runtime, hostIndex, project))
      : [],
  )
  const draftHosts = fleet.hosts.flatMap((runtime) =>
    runtime.status === 'online'
      ? [{ id: runtime.config.id, name: runtime.config.name }]
      : [],
  )

  /** Opens an unbound draft; ChatPane binds it to an online project before first send. */
  const newGlobalSession = () => {
    const target: FleetSession = {
      key: 'global::draft',
      hostId: '',
      hostName: '',
      hostColorIdx: 0,
      baseUrl: '',
      projectName: '',
      projectPath: '',
      projectId: '',
      session: {
        id: '',
        provider: 'claude',
        summary: '',
        messageCount: 0,
        lastActivity: new Date().toISOString(),
      },
      href: '',
      stale: false,
      justUpdated: false,
    }
    setView({ kind: 'chat', target, from: { kind: 'feed' }, sessionView: 'structured' })
  }

  function findProject(hostId: string, projectId: string) {
    const hostIndex = fleet.hosts.findIndex((runtime) => runtime.config.id === hostId)
    const runtime = hostIndex >= 0 ? fleet.hosts[hostIndex] : undefined
    const project = runtime?.projects.find((p) => p.projectId === projectId)
    return { hostIndex, runtime, project }
  }

  // Mirror the open chat into the URL hash so it can be copied/shared. Cleared
  // for every other view. Skipped while a deep-link is still resolving so we
  // don't wipe the incoming hash before we've read it.
  useEffect(() => {
    if (linkRequest) return
    const next = view.kind === 'chat' && view.target.session.id ? sessionHash(view.target) : ''
    const current = window.location.hash
    if (current === next || (!current && !next)) return
    applyingHashRef.current = true
    if (next) {
      window.location.hash = next
    } else {
      // Drop the fragment without leaving a bare "#" in the address bar.
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      applyingHashRef.current = false
    }
  }, [view, linkRequest])

  // Pick up links pasted into the same tab or reached via back/forward.
  useEffect(() => {
    const onHashChange = () => {
      if (applyingHashRef.current) {
        applyingHashRef.current = false
        return
      }
      setLinkRequest(parseSessionHash(window.location.hash))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Resolve a pending deep-link once its host has finished loading. Ordinary
  // sessions reuse discovery metadata. An exact-id lookup fills the same target
  // for a known child transcript that is intentionally hidden from discovery.
  useEffect(() => {
    if (!linkRequest) return
    let cancelled = false
    const runtime = fleet.hosts.find((r) => r.config.id === linkRequest.hostId)
    // Host still coming up — wait for the next hosts update before deciding.
    if (runtime && runtime.status === 'loading') return
    const project = runtime?.projects.find((p) => p.projectId === linkRequest.projectId)
    const session = project?.sessions.find((s) => s.id === linkRequest.sessionId)
    if (runtime && project && session) {
      openSessionFromSidebar(runtime.config.id, project.projectId, session)
      setLinkRequest(null)
      return
    }

    if (!runtime || !project || runtime.status !== 'online') {
      setCreateError(
        'That session link could not be opened — it may have been archived, or its host is offline.',
      )
      setLinkRequest(null)
      return
    }

    const token = getToken(runtime.config.id)
    if (!token) {
      setCreateError('That session link could not be opened — sign in to its host first.')
      setLinkRequest(null)
      return
    }

    void getSessionById(
      runtime.config.baseUrl,
      token,
      linkRequest.sessionId,
      (refreshed) => saveToken(runtime.config.id, refreshed),
    )
      .then((direct) => {
        if (cancelled) return
        if (
          direct.projectId !== project.projectId ||
          direct.isArchived ||
          direct.isProjectArchived
        ) {
          throw new Error('The session is archived or belongs to a different project.')
        }
        openSessionFromSidebar(runtime.config.id, project.projectId, {
          id: direct.sessionId,
          provider: direct.provider,
          summary: direct.sessionTitle,
          messageCount: 0,
          lastActivity: direct.lastActivity ?? new Date(0).toISOString(),
        })
      })
      .catch(() => {
        if (!cancelled) {
          setCreateError(
            'That session link could not be opened — it may have been archived, or its host is offline.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLinkRequest(null)
      })

    return () => {
      cancelled = true
    }
    // openSessionFromSidebar is recreated each render; the effect is driven by
    // linkRequest/hosts and re-reads it lazily, so it's intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkRequest, fleet.hosts])

  function renderMain() {
    if (fleet.hosts.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Server size={32} className="text-fg-subtle" />
          <div>
            <h2 className="font-display text-base font-semibold text-fg">No hosts configured</h2>
            <p className="mt-1 max-w-sm text-sm text-fg-faint">
              Add your CloudCLI instances — remote VMs or localhost — and their projects and
              sessions will appear here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong"
          >
            Add your first host
          </button>
        </div>
      )
    }
    if (view.kind === 'chat') {
      const { hostIndex, runtime, project } = findProject(view.target.hostId, view.target.projectId)
      const panelAvailable = Boolean(runtime && project)
      const PanelComponent = chatPanel === 'files' ? FileBrowser : GitPanel
      if (view.sessionView === 'terminal') {
        return (
          <TerminalPanel
            key={`terminal:${view.target.hostId}:${view.target.session.id || view.target.key}`}
            target={view.target}
            onBack={() => setView(view.from)}
            onShowStructured={() =>
              setView((current) =>
                current.kind === 'chat' ? { ...current, sessionView: 'structured' } : current,
              )
            }
          />
        )
      }
      return (
        <div className="flex min-h-0 min-w-0 flex-1">
          <ChatPane
            key={view.target.key}
            target={view.target}
            onBack={() => setView(view.from)}
            panel={panelAvailable ? chatPanel : null}
            onTogglePanel={panelAvailable ? toggleChatPanel : undefined}
            onOpenTerminal={
              panelAvailable
                ? () =>
                    setView((current) =>
                      current.kind === 'chat' ? { ...current, sessionView: 'terminal' } : current,
                    )
                : undefined
            }
            draftTargets={view.target.key === 'global::draft' ? draftTargets : undefined}
            draftHosts={view.target.key === 'global::draft' ? draftHosts : undefined}
            onCreateDraftProject={
              view.target.key === 'global::draft'
                ? async (hostId, projectPath) => {
                    const hostIndex = fleet.hosts.findIndex(
                      (runtime) => runtime.config.id === hostId,
                    )
                    const runtime = hostIndex >= 0 ? fleet.hosts[hostIndex] : undefined
                    if (!runtime) throw new Error('Host is no longer available')
                    const project = await fleet.createProject(hostId, projectPath)
                    return draftTargetFor(runtime, hostIndex, project)
                  }
                : undefined
            }
            onCloneDraftProject={
              view.target.key === 'global::draft'
                ? async (hostId, workspacePath, repositoryUrl, onProgress, signal) => {
                    const hostIndex = fleet.hosts.findIndex(
                      (runtime) => runtime.config.id === hostId,
                    )
                    const runtime = hostIndex >= 0 ? fleet.hosts[hostIndex] : undefined
                    if (!runtime) throw new Error('Host is no longer available')
                    const project = await fleet.cloneProject(
                      hostId,
                      workspacePath,
                      repositoryUrl,
                      onProgress,
                      signal,
                    )
                    return draftTargetFor(runtime, hostIndex, project)
                  }
                : undefined
            }
            onDraftTargetChange={(nextTarget) => {
              fleet.markProjectOpened(nextTarget.hostId, nextTarget.projectId)
              setView((current) =>
                current.kind === 'chat' && current.target.key === 'global::draft'
                  ? { ...current, target: { ...nextTarget, key: 'global::draft' } }
                  : current,
              )
            }}
            onSessionCreated={(sessionId) => {
              setView((current) =>
                current.kind === 'chat' && current.target.key === view.target.key
                  ? {
                      ...current,
                      target: {
                        ...current.target,
                        href: `${current.target.baseUrl}/session/${sessionId}`,
                        session: { ...current.target.session, id: sessionId },
                      },
                    }
                  : current,
              )
              fleet.refresh()
            }}
          />
          {panelAvailable && chatPanel && runtime && project && (
            <div className="relative flex shrink-0" style={{ width: chatPanelWidth }}>
              <div
                onPointerDown={startChatPanelResize}
                title="Drag to resize"
                className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize transition-colors hover:bg-elevated-strong/50"
              />
              <aside className="flex min-w-0 flex-1 flex-col border-l border-line/80">
                <PanelComponent
                  key={`${chatPanel}:${view.target.hostId}:${view.target.projectId}`}
                  runtime={runtime}
                  hostColorIdx={hostIndex}
                  project={project}
                  onBack={() => toggleChatPanel(chatPanel)}
                  embedded
                />
              </aside>
            </div>
          )}
        </div>
      )
    }
    if (view.kind === 'files' || view.kind === 'git') {
      const { hostIndex, runtime, project } = findProject(view.hostId, view.projectId)
      if (!runtime || !project) {
        return (
          <p className="flex flex-1 items-center justify-center text-sm text-fg-faint">
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
          <p className="flex flex-1 items-center justify-center text-sm text-fg-faint">
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
          onArchiveProject={async () => {
            await fleet.archiveProject(view.hostId, view.projectId)
            setView({ kind: 'feed' })
          }}
          onRenameProject={(displayName) => renameProject(view.hostId, view.projectId, displayName)}
          onArchiveSession={(sessionId) => archiveSession(view.hostId, sessionId)}
          onRenameSession={(sessionId, summary) =>
            renameSession(view.hostId, sessionId, summary)
          }
        />
      )
    }
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="font-display text-sm font-semibold text-fg-secondary">All sessions</h2>
            <button
              type="button"
              onClick={newGlobalSession}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-on-accent transition-colors hover:bg-accent-strong"
            >
              <Plus size={13} /> New session
            </button>
          </div>
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
            onRename={(item, summary) => renameSession(item.hostId, item.session.id, summary)}
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
        onRenameProject={renameProject}
        onArchiveSession={archiveSession}
        onRenameSession={renameSession}
        onRestoreSession={fleet.restoreSession}
        onRestoreProject={fleet.restoreProject}
        onDeleteSessionForever={fleet.deleteSessionForever}
        onSignIn={setLoginHostId}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onRefresh={fleet.refresh}
      />
      <main className="flex min-w-0 flex-1 flex-col">{renderMain()}</main>
      <AnimatePresence>
        {createError && (
          <motion.div
            initial={{ opacity: 0, y: 12, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 8, x: '-50%' }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="fixed bottom-4 left-1/2 z-50 flex items-center gap-2 rounded-md border border-rose-900/60 bg-surface px-3 py-2 text-xs text-rose-400 shadow-lg"
          >
            <span>{createError}</span>
            <button
              type="button"
              onClick={() => setCreateError(null)}
              className="rounded p-0.5 text-fg-faint hover:text-fg"
            >
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {searchOpen && (
          <SearchOverlay
            hosts={fleet.hosts}
            onOpenSession={openChat}
            onClose={() => setSearchOpen(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {settingsOpen && (
          <SettingsPanel
            hosts={fleet.hosts}
            prefs={fleet.prefs}
            theme={theme}
            onChangeTheme={setTheme}
            onAddHost={fleet.addHost}
            onRemoveHost={fleet.removeHost}
            onUpdatePrefs={fleet.updatePrefs}
            onClearTokens={fleet.clearTokens}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
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
      </AnimatePresence>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FleetSession, HostConfig, HostRuntime, HostStatus, Prefs, Project } from '../types'
import {
  AuthError,
  HostUnreachableError,
  archiveSession as apiArchiveSession,
  deleteSessionPermanently as apiDeleteSessionPermanently,
  getAuthStatus,
  getProjects,
  getRunningSessions,
  login,
  register,
  restoreSession as apiRestoreSession,
  toggleProjectStar,
} from '../lib/api'
import * as storage from '../lib/storage'

const POLL_INTERVAL_MS = 12_000
const INITIAL_STAGGER_MS = 300
const MAX_FEED_LENGTH = 120

interface RuntimePatch {
  status: HostStatus
  projects?: Project[]
  runningSessionIds?: ReadonlySet<string>
  lastError?: string
}

export interface NewHostInput {
  name: string
  baseUrl: string
  username?: string
}

export function useFleet() {
  const [hostConfigs, setHostConfigs] = useState<HostConfig[]>(() => storage.loadHosts())
  const [prefs, setPrefs] = useState<Prefs>(() => storage.loadPrefs())
  const [runtimes, setRuntimes] = useState<Record<string, HostRuntime>>({})
  const inFlight = useRef(new Set<string>())
  const hostsRef = useRef(hostConfigs)
  hostsRef.current = hostConfigs

  const patchRuntime = useCallback((config: HostConfig, patch: RuntimePatch) => {
    setRuntimes((prev) => {
      const existing = prev[config.id]
      return {
        ...prev,
        [config.id]: {
          config,
          status: patch.status,
          // Keep the last-known projects when a host goes offline so its
          // sessions stay visible (dimmed as stale) instead of vanishing.
          projects: patch.projects ?? existing?.projects ?? [],
          // Running state is ephemeral — never carry it across a failed poll.
          runningSessionIds: patch.runningSessionIds,
          lastError: patch.lastError,
          lastSuccessAt: patch.projects ? Date.now() : existing?.lastSuccessAt,
        },
      }
    })
  }, [])

  const pollHost = useCallback(
    async (config: HostConfig) => {
      // Hibernating hosts eat the full fetch timeout — don't stack requests.
      if (inFlight.current.has(config.id)) return
      inFlight.current.add(config.id)
      try {
        const token = storage.getToken(config.id)
        if (token) {
          try {
            const saveRefreshed = (refreshed: string) => storage.saveToken(config.id, refreshed)
            const [projects, runningSessionIds] = await Promise.all([
              getProjects(config.baseUrl, token, saveRefreshed),
              // Best-effort: hosts on older CloudCLI don't have this endpoint.
              getRunningSessions(config.baseUrl, token, saveRefreshed)
                .then((ids) => new Set(ids) as ReadonlySet<string>)
                .catch(() => undefined),
            ])
            patchRuntime(config, { status: 'online', projects, runningSessionIds })
          } catch (err) {
            if (err instanceof AuthError) {
              storage.deleteToken(config.id)
              patchRuntime(config, { status: 'needs-auth' })
            } else if (err instanceof HostUnreachableError) {
              patchRuntime(config, { status: 'offline' })
            } else {
              patchRuntime(config, {
                status: 'offline',
                lastError: err instanceof Error ? err.message : String(err),
              })
            }
          }
        } else {
          try {
            const authStatus = await getAuthStatus(config.baseUrl)
            patchRuntime(config, { status: authStatus.needsSetup ? 'needs-setup' : 'needs-auth' })
          } catch {
            patchRuntime(config, { status: 'offline' })
          }
        }
      } finally {
        inFlight.current.delete(config.id)
      }
    },
    [patchRuntime],
  )

  const refresh = useCallback(() => {
    for (const config of hostsRef.current) void pollHost(config)
  }, [pollHost])

  useEffect(() => {
    const timers = hostConfigs.map((config, index) =>
      setTimeout(() => void pollHost(config), index * INITIAL_STAGGER_MS),
    )
    return () => timers.forEach(clearTimeout)
  }, [hostConfigs, pollHost])

  useEffect(() => {
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  /**
   * Password lives only in the caller's component state — never persisted.
   * `setup` runs CloudCLI's one-time registration instead of login (both return a JWT).
   */
  const loginHost = useCallback(
    async (hostId: string, username: string, password: string, mode: 'login' | 'setup' = 'login') => {
      const config = hostsRef.current.find((host) => host.id === hostId)
      if (!config) throw new Error('Unknown host')
      const token =
        mode === 'setup'
          ? await register(config.baseUrl, username, password)
          : await login(config.baseUrl, username, password)
      storage.saveToken(hostId, token)
      patchRuntime(config, { status: 'loading' })
      void pollHost(config)
    },
    [patchRuntime, pollHost],
  )

  const addHost = useCallback((input: NewHostInput) => {
    const config: HostConfig = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      baseUrl: storage.normalizeBaseUrl(input.baseUrl),
      username: input.username?.trim() || undefined,
    }
    setHostConfigs((prev) => {
      const next = [...prev, config]
      storage.saveHosts(next)
      return next
    })
  }, [])

  const removeHost = useCallback((hostId: string) => {
    storage.deleteToken(hostId)
    setHostConfigs((prev) => {
      const next = prev.filter((host) => host.id !== hostId)
      storage.saveHosts(next)
      return next
    })
  }, [])

  const updatePrefs = useCallback((next: Prefs) => {
    setPrefs(next)
    storage.savePrefs(next)
  }, [])

  const [recent, setRecent] = useState<Record<string, number>>(() => storage.loadRecentProjects())

  const markProjectOpened = useCallback((hostId: string, projectId: string) => {
    const at = Date.now()
    storage.markProjectOpened(hostId, projectId, at)
    setRecent((prev) => ({ ...prev, [`${hostId}:${projectId}`]: at }))
  }, [])

  const toggleStar = useCallback(async (hostId: string, projectId: string) => {
    const config = hostsRef.current.find((host) => host.id === hostId)
    const token = storage.getToken(hostId)
    if (!config || !token) return
    // Optimistic flip, then reconcile with the server's returned state.
    const flip = (value: boolean) =>
      setRuntimes((prev) => {
        const existing = prev[hostId]
        if (!existing) return prev
        return {
          ...prev,
          [hostId]: {
            ...existing,
            projects: existing.projects.map((project) =>
              project.projectId === projectId ? { ...project, isStarred: value } : project,
            ),
          },
        }
      })
    const project = runtimes[hostId]?.projects.find((p) => p.projectId === projectId)
    const optimistic = !(project?.isStarred ?? false)
    flip(optimistic)
    try {
      const actual = await toggleProjectStar(config.baseUrl, token, projectId, (t) =>
        storage.saveToken(hostId, t),
      )
      if (actual !== optimistic) flip(actual)
    } catch {
      flip(!optimistic)
    }
  }, [runtimes])

  /** Optimistically drops the session from active lists, then archives on the host. */
  const archiveSession = useCallback(
    async (hostId: string, sessionId: string): Promise<boolean> => {
      const config = hostsRef.current.find((host) => host.id === hostId)
      const token = storage.getToken(hostId)
      if (!config || !token) return false
      setRuntimes((prev) => {
        const existing = prev[hostId]
        if (!existing) return prev
        return {
          ...prev,
          [hostId]: {
            ...existing,
            projects: existing.projects.map((project) =>
              project.sessions.some((session) => session.id === sessionId)
                ? {
                    ...project,
                    sessions: project.sessions.filter((session) => session.id !== sessionId),
                    sessionMeta: {
                      ...project.sessionMeta,
                      total: Math.max(0, project.sessionMeta.total - 1),
                    },
                  }
                : project,
            ),
          },
        }
      })
      try {
        await apiArchiveSession(config.baseUrl, token, sessionId, (t) => storage.saveToken(hostId, t))
        return true
      } catch {
        // Reconcile — the poll restores the session if the archive didn't land.
        void pollHost(config)
        return false
      }
    },
    [pollHost],
  )

  /** Restores an archived session and re-polls so it reappears in the sidebar. */
  const restoreSession = useCallback(
    async (hostId: string, sessionId: string): Promise<void> => {
      const config = hostsRef.current.find((host) => host.id === hostId)
      const token = storage.getToken(hostId)
      if (!config || !token) throw new Error('Not signed in')
      await apiRestoreSession(config.baseUrl, token, sessionId, (t) => storage.saveToken(hostId, t))
      void pollHost(config)
    },
    [pollHost],
  )

  /** Permanently deletes a session (DB row + transcript on the host's disk). */
  const deleteSessionForever = useCallback(
    async (hostId: string, sessionId: string): Promise<void> => {
      const config = hostsRef.current.find((host) => host.id === hostId)
      const token = storage.getToken(hostId)
      if (!config || !token) throw new Error('Not signed in')
      await apiDeleteSessionPermanently(config.baseUrl, token, sessionId, (t) =>
        storage.saveToken(hostId, t),
      )
    },
    [],
  )

  const clearTokens = useCallback(() => {
    storage.clearTokens()
    refresh()
  }, [refresh])

  const hosts: HostRuntime[] = useMemo(
    () =>
      hostConfigs.map(
        (config) => runtimes[config.id] ?? { config, status: 'loading' as HostStatus, projects: [] },
      ),
    [hostConfigs, runtimes],
  )

  const prevActivity = useRef(new Map<string, string>())
  const sessions: FleetSession[] = useMemo(() => {
    const seen = prevActivity.current
    const nextActivity = new Map<string, string>()
    const merged = hosts
      .flatMap((runtime, hostIndex) =>
        runtime.projects.flatMap((project) =>
          project.sessions.map((session): FleetSession => {
            const key = `${runtime.config.id}:${session.id}`
            nextActivity.set(key, session.lastActivity)
            const previous = seen.get(key)
            return {
              key,
              hostId: runtime.config.id,
              hostName: runtime.config.name,
              hostColorIdx: hostIndex,
              baseUrl: runtime.config.baseUrl,
              projectName: project.displayName,
              projectPath: project.fullPath,
              projectId: project.projectId,
              session,
              href: `${runtime.config.baseUrl}/session/${session.id}`,
              stale: runtime.status !== 'online',
              justUpdated: previous !== undefined && previous !== session.lastActivity,
              running: runtime.runningSessionIds
                ? runtime.runningSessionIds.has(session.id)
                : undefined,
            }
          }),
        ),
      )
      .filter((item) => !prefs.hideCursor || item.session.provider !== 'cursor')
      .sort((a, b) => Date.parse(b.session.lastActivity) - Date.parse(a.session.lastActivity))
      .slice(0, MAX_FEED_LENGTH)
    prevActivity.current = nextActivity
    return merged
  }, [hosts, prefs.hideCursor])

  return {
    hosts,
    sessions,
    prefs,
    recent,
    updatePrefs,
    addHost,
    removeHost,
    loginHost,
    clearTokens,
    refresh,
    toggleStar,
    markProjectOpened,
    archiveSession,
    restoreSession,
    deleteSessionForever,
  }
}

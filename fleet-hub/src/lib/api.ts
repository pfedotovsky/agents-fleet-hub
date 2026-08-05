import type {
  ArchivedProject,
  ArchivedSession,
  FileNode,
  GitBranches,
  GitCommitSummary,
  GitRemoteStatus,
  GitStatus,
  MessagesPage,
  ModelCatalog,
  ModelOption,
  Project,
  ProjectDeletionPreview,
  Provider,
  SessionSummary,
  SlashCommand,
  StoredImage,
  TokenBudget,
} from '../types'

export class HostUnreachableError extends Error {
  constructor(baseUrl: string) {
    super(`Cannot reach ${baseUrl}`)
    this.name = 'HostUnreachableError'
  }
}

export class AuthError extends Error {
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'AuthError'
  }
}

export const SESSIONS_PER_PROJECT = 5

interface RequestOptions {
  token?: string
  timeoutMs?: number
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  onTokenRefresh?: (token: string) => void
}

function apiErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const error = (body as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return undefined
  const message = (error as { message?: unknown }).message
  const details = (error as { details?: unknown }).details
  if (typeof message !== 'string') return undefined
  return typeof details === 'string' && details !== message ? `${message}: ${details}` : message
}

async function fetchJson(baseUrl: string, path: string, opts: RequestOptions = {}): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000)
  let res: Response
  try {
    const headers: Record<string, string> = {}
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    res = await fetch(`${baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    })
  } catch {
    throw new HostUnreachableError(baseUrl)
  } finally {
    clearTimeout(timer)
  }

  // CloudCLI sends a sliding-refresh JWT on authenticated responses; always capture it.
  const refreshed = res.headers.get('X-Refreshed-Token')
  if (refreshed && opts.onTokenRefresh) opts.onTokenRefresh(refreshed)

  if (res.status === 401 || res.status === 403) {
    const message = await res
      .json()
      .then(apiErrorMessage)
      .catch(() => undefined)
    throw new AuthError(message)
  }
  if (!res.ok) {
    const message = await res
      .json()
      .then(apiErrorMessage)
      .catch(() => undefined)
    throw new Error(message ?? `${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function getAuthStatus(
  baseUrl: string,
): Promise<{ needsSetup: boolean; localAuthBypass?: boolean }> {
  return (await fetchJson(baseUrl, '/api/auth/status')) as {
    needsSetup: boolean
    localAuthBypass?: boolean
  }
}

/**
 * Mints a JWT for a same-machine (loopback) fleet-server without a password.
 * The server only honors this for loopback clients; the returned token behaves
 * exactly like a login token (7-day expiry, sliding refresh).
 */
export async function getLocalToken(baseUrl: string): Promise<string> {
  const body = (await fetchJson(baseUrl, '/api/auth/local-token', {
    method: 'POST',
    timeoutMs: 10000,
  })) as { token?: string }
  if (!body.token) throw new Error('Local-token response did not include a token')
  return body.token
}

export interface DiscoveredHost {
  baseUrl: string
  /** 'fleet-server' | 'cloudcli' — distinguished by the /health payload. */
  kind: 'fleet-server' | 'cloudcli'
  version: string | null
}

/**
 * Well-known localhost ports for an agent server. The Vite UI deliberately
 * targets source fleet-server on 3012; packaged builds target the released
 * fleet-server on 3011. Stock CloudCLI remains on 3001.
 */
const LOCAL_FLEET_SERVER_URL = import.meta.env.DEV
  ? 'http://localhost:3012'
  : 'http://localhost:3011'
const LOCAL_DISCOVERY_URLS = [LOCAL_FLEET_SERVER_URL, 'http://localhost:3001'] as const

async function probeLocalHealth(baseUrl: string): Promise<DiscoveredHost | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1500)
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal })
    if (!res.ok) return null
    const body = (await res.json()) as { status?: string; version?: string; installMode?: string }
    if (body.status !== 'ok') return null
    // Only CloudCLI's /health carries `installMode`; fleet-server omits it.
    const kind = body.installMode !== undefined ? 'cloudcli' : 'fleet-server'
    return { baseUrl, kind, version: body.version ?? null }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probes well-known localhost ports for a reachable agent server, excluding
 * URLs already configured. Used to offer a one-click "add localhost" instead
 * of making the user type the URL.
 */
export async function discoverLocalHosts(existingBaseUrls: string[]): Promise<DiscoveredHost[]> {
  const existing = new Set(existingBaseUrls.map((url) => url.replace(/\/+$/, '')))
  const results = await Promise.all(
    LOCAL_DISCOVERY_URLS.filter((url) => !existing.has(url)).map((url) => probeLocalHealth(url)),
  )
  return results.filter((entry): entry is DiscoveredHost => entry !== null)
}

export async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const body = (await fetchJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
    timeoutMs: 10000,
  })) as { token?: string }
  if (!body.token) throw new Error('Login response did not include a token')
  return body.token
}

/**
 * First-time setup: creates the host's single user and returns its JWT.
 * CloudCLI only allows this while no user exists (403 afterwards).
 * Server rules: username ≥ 3 chars, password ≥ 6 chars.
 */
export async function register(baseUrl: string, username: string, password: string): Promise<string> {
  const body = (await fetchJson(baseUrl, '/api/auth/register', {
    method: 'POST',
    body: { username, password },
    timeoutMs: 10000,
  })) as { token?: string }
  if (!body.token) throw new Error('Setup response did not include a token')
  return body.token
}

export async function getProjects(
  baseUrl: string,
  token: string,
  onTokenRefresh: (token: string) => void,
): Promise<Project[]> {
  // This call triggers a disk→DB session sync on the host, so it can be slow-ish.
  return (await fetchJson(baseUrl, `/api/projects?sessionsLimit=${SESSIONS_PER_PROJECT}`, {
    token,
    onTokenRefresh,
    timeoutMs: 10000,
  })) as Project[]
}

/** Creates or registers a project folder on one host. */
export async function createProject(
  baseUrl: string,
  token: string,
  projectPath: string,
  onTokenRefresh: (token: string) => void,
): Promise<Project> {
  const body = (await fetchJson(baseUrl, '/api/projects/create-project', {
    method: 'POST',
    token,
    body: { path: projectPath },
    onTokenRefresh,
    timeoutMs: 10000,
  })) as { success: boolean; project: Project }
  return body.project
}

export interface CloneProjectOptions {
  workspacePath: string
  repositoryUrl: string
  onProgress: (message: string) => void
  onTokenRefresh: (token: string) => void
  signal?: AbortSignal
}

/** Clones a repository on one host and resolves with the registered project. */
export async function cloneProject(
  baseUrl: string,
  token: string,
  options: CloneProjectOptions,
): Promise<Project> {
  let parsedRepositoryUrl: URL | null = null
  try {
    parsedRepositoryUrl = new URL(options.repositoryUrl)
  } catch {
    // SSH shorthands and host-local paths are valid Git sources but not URL instances.
  }
  if (
    parsedRepositoryUrl &&
    (parsedRepositoryUrl.protocol === 'http:' || parsedRepositoryUrl.protocol === 'https:') &&
    (parsedRepositoryUrl.username || parsedRepositoryUrl.password)
  ) {
    throw new Error('Use repository credentials configured on the host, not in the URL')
  }

  const query = new URLSearchParams({
    path: options.workspacePath,
    githubUrl: options.repositoryUrl,
  })
  let res: Response
  try {
    res = await fetch(`${baseUrl}/api/projects/clone-progress?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: options.signal,
    })
  } catch {
    if (options.signal?.aborted) {
      throw new DOMException('Repository clone cancelled', 'AbortError')
    }
    throw new HostUnreachableError(baseUrl)
  }

  const refreshed = res.headers.get('X-Refreshed-Token')
  if (refreshed) options.onTokenRefresh(refreshed)

  if (res.status === 401 || res.status === 403) {
    const message = await res
      .json()
      .then(apiErrorMessage)
      .catch(() => undefined)
    throw new AuthError(message)
  }
  if (!res.ok) {
    const message = await res
      .json()
      .then(apiErrorMessage)
      .catch(() => undefined)
    throw new Error(message ?? `${res.status} ${res.statusText}`)
  }
  if (!res.body) throw new Error('Clone progress stream was unavailable')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completedProject: Project | null = null

  const consumeEvent = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return

    let event: { type?: unknown; message?: unknown; project?: unknown }
    try {
      event = JSON.parse(data) as typeof event
    } catch {
      throw new Error('Host sent invalid clone progress data')
    }

    if (event.type === 'progress' && typeof event.message === 'string') {
      options.onProgress(event.message)
      return
    }
    if (event.type === 'error') {
      throw new Error(
        typeof event.message === 'string' ? event.message : 'Repository clone failed',
      )
    }
    if (event.type === 'complete' && event.project && typeof event.project === 'object') {
      completedProject = event.project as Project
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let boundary = /\r?\n\r?\n/.exec(buffer)
    while (boundary?.index !== undefined) {
      const block = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary[0].length)
      consumeEvent(block)
      boundary = /\r?\n\r?\n/.exec(buffer)
    }
    if (done) break
  }
  if (buffer.trim()) consumeEvent(buffer)
  if (!completedProject) throw new Error('Clone progress stream ended before completion')
  return completedProject
}

/** Soft-archives a project in the host DB; files and session transcripts stay on disk. */
export async function archiveProject(
  baseUrl: string,
  token: string,
  projectId: string,
  onTokenRefresh: (token: string) => void,
): Promise<void> {
  await fetchJson(baseUrl, `/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    token,
    onTokenRefresh,
    timeoutMs: 10000,
  })
}

/** Restores an archived project back into the host's active project list. */
export async function restoreProject(
  baseUrl: string,
  token: string,
  projectId: string,
  onTokenRefresh: (token: string) => void,
): Promise<void> {
  await fetchJson(baseUrl, `/api/projects/${encodeURIComponent(projectId)}/restore`, {
    method: 'POST',
    token,
    onTokenRefresh,
    timeoutMs: 10000,
  })
}

/** Changes only a project's user-visible name; the host folder path is untouched. */
export async function renameProject(
  baseUrl: string,
  token: string,
  projectId: string,
  displayName: string,
  onTokenRefresh: (token: string) => void,
): Promise<{ displayName: string; customName: string | null } | null> {
  const body = (await fetchJson(baseUrl, `/api/projects/${encodeURIComponent(projectId)}/rename`, {
    method: 'PUT',
    token,
    body: { displayName },
    onTokenRefresh,
    timeoutMs: 10000,
  })) as { success: boolean; displayName?: unknown; customName?: unknown }
  if (typeof body.displayName !== 'string') return null
  return {
    displayName: body.displayName,
    customName: typeof body.customName === 'string' ? body.customName : null,
  }
}

/** All soft-archived projects on a host, including preserved session summaries. */
export async function getArchivedProjects(
  baseUrl: string,
  token: string,
  onTokenRefresh: (token: string) => void,
): Promise<ArchivedProject[]> {
  const body = (await fetchJson(baseUrl, '/api/projects/archived', {
    token,
    onTokenRefresh,
    timeoutMs: 10000,
  })) as { success: boolean; data: { projects: ArchivedProject[] } }
  return body.data.projects ?? []
}

/** Safety and impact preview required before permanently deleting an archived project. */
export async function getProjectDeletionPreview(
  baseUrl: string,
  token: string,
  projectId: string,
  onTokenRefresh: (token: string) => void,
): Promise<ProjectDeletionPreview> {
  const body = (await fetchJson(
    baseUrl,
    `/api/projects/${encodeURIComponent(projectId)}/deletion-preview`,
    { token, onTokenRefresh, timeoutMs: 30000 },
  )) as { success: boolean; data: { preview: ProjectDeletionPreview } }
  return body.data.preview
}

/** Permanently removes an archived project after exact canonical-path confirmation. */
export async function deleteProjectPermanently(
  baseUrl: string,
  token: string,
  projectId: string,
  confirmationPath: string,
  onTokenRefresh: (token: string) => void,
): Promise<void> {
  await fetchJson(baseUrl, `/api/projects/${encodeURIComponent(projectId)}?force=true`, {
    method: 'DELETE',
    token,
    body: { confirmationPath },
    onTokenRefresh,
    timeoutMs: 120000,
  })
}

/** App-facing ids of sessions whose agent run is currently processing (status-only, cheap). */
export async function getRunningSessions(
  baseUrl: string,
  token: string,
  onTokenRefresh: (token: string) => void,
): Promise<string[]> {
  const body = (await fetchJson(baseUrl, '/api/providers/sessions/running', {
    token,
    onTokenRefresh,
  })) as { success: boolean; data: { sessions: { sessionId: string }[] } }
  return (body.data.sessions ?? []).map((session) => session.sessionId)
}

/**
 * Fetches a page of the provider-normalized transcript. `offset: 0` returns the
 * newest `limit` messages; increasing offsets walk backwards in time. The offset
 * counts raw returned messages (including `tool_result` entries), so pass the
 * number of messages already loaded.
 */
export async function getSessionMessages(
  baseUrl: string,
  token: string,
  sessionId: string,
  page: { limit: number; offset: number },
  onTokenRefresh: (token: string) => void,
): Promise<MessagesPage> {
  const body = (await fetchJson(
    baseUrl,
    `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages?limit=${page.limit}&offset=${page.offset}`,
    { token, onTokenRefresh, timeoutMs: 15000 },
  )) as { success: boolean; data: MessagesPage }
  return body.data
}

/** Latest persisted context-window occupancy for an existing session. */
export async function getSessionTokenUsage(
  baseUrl: string,
  token: string,
  projectId: string,
  sessionId: string,
  onTokenRefresh: (token: string) => void,
): Promise<TokenBudget> {
  return (await fetchJson(
    baseUrl,
    `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/token-usage`,
    { token, onTokenRefresh, timeoutMs: 10000 },
  )) as TokenBudget
}

/** Creates a new (empty) app session in a project; the first chat.send starts the agent. */
export async function createSession(
  baseUrl: string,
  token: string,
  provider: Provider,
  projectPath: string,
  onTokenRefresh: (token: string) => void,
): Promise<{ sessionId: string; provider: Provider; projectPath: string }> {
  const body = (await fetchJson(baseUrl, '/api/providers/sessions', {
    method: 'POST',
    token,
    body: { provider, projectPath },
    onTokenRefresh,
    timeoutMs: 10000,
  })) as { success: boolean; data: { sessionId: string; provider: Provider; projectPath: string } }
  return body.data
}

/** Replaces a session's user-visible title. The host trims and caps it at 500 characters. */
export async function renameSession(
  baseUrl: string,
  token: string,
  sessionId: string,
  summary: string,
  onTokenRefresh: (token: string) => void,
): Promise<void> {
  await fetchJson(baseUrl, `/api/providers/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    token,
    body: { summary },
    onTokenRefresh,
    timeoutMs: 10000,
  })
}

/** Soft-archives a session: it leaves all active lists but stays restorable. */
export async function archiveSession(
  baseUrl: string,
  token: string,
  sessionId: string,
  onTokenRefresh: (token: string) => void,
): Promise<void> {
  await fetchJson(baseUrl, `/api/providers/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    token,
    onTokenRefresh,
    timeoutMs: 10000,
  })
}

/** Permanently deletes a session, including its transcript file on the host's disk. */
export async function deleteSessionPermanently(
  baseUrl: string,
  token: string,
  sessionId: string,
  onTokenRefresh: (token: string) => void,
): Promise<void> {
  await fetchJson(baseUrl, `/api/providers/sessions/${encodeURIComponent(sessionId)}?force=true`, {
    method: 'DELETE',
    token,
    onTokenRefresh,
    timeoutMs: 10000,
  })
}

/** Restores an archived session back into the active lists. */
export async function restoreSession(
  baseUrl: string,
  token: string,
  sessionId: string,
  onTokenRefresh: (token: string) => void,
): Promise<void> {
  await fetchJson(baseUrl, `/api/providers/sessions/${encodeURIComponent(sessionId)}/restore`, {
    method: 'POST',
    token,
    onTokenRefresh,
    timeoutMs: 10000,
  })
}

/** All archived sessions on a host, with project metadata for grouping/restore. */
export async function getArchivedSessions(
  baseUrl: string,
  token: string,
  onTokenRefresh: (token: string) => void,
): Promise<ArchivedSession[]> {
  const body = (await fetchJson(baseUrl, '/api/providers/sessions/archived', {
    token,
    onTokenRefresh,
    timeoutMs: 10000,
  })) as { success: boolean; data: { sessions: ArchivedSession[] } }
  return body.data.sessions ?? []
}

/** Pages through one project's sessions (newest first, archived excluded). */
export async function getProjectSessions(
  baseUrl: string,
  token: string,
  projectId: string,
  page: { limit: number; offset: number },
  onTokenRefresh: (token: string) => void,
): Promise<{ sessions: SessionSummary[]; sessionMeta: { hasMore: boolean; total: number } }> {
  return (await fetchJson(
    baseUrl,
    `/api/projects/${encodeURIComponent(projectId)}/sessions?limit=${page.limit}&offset=${page.offset}`,
    { token, onTokenRefresh, timeoutMs: 10000 },
  )) as { sessions: SessionSummary[]; sessionMeta: { hasMore: boolean; total: number } }
}

/** Model catalog for a provider. Response is {OPTIONS:[{value,label,...}], DEFAULT}. */
export async function getModels(
  baseUrl: string,
  token: string,
  provider: Provider,
  onTokenRefresh: (token: string) => void,
): Promise<ModelCatalog> {
  const body = (await fetchJson(baseUrl, `/api/providers/${provider}/models`, {
    token,
    onTokenRefresh,
    timeoutMs: 10000,
  })) as { success: boolean; data: { models: { OPTIONS: ModelOption[]; DEFAULT: string } } }
  return { options: body.data.models.OPTIONS ?? [], default: body.data.models.DEFAULT ?? 'default' }
}

/** Install/login state of a provider's CLI on the host (e.g. codex). */
export interface ProviderAuthStatus {
  installed?: boolean
  authenticated?: boolean
  email?: string
  method?: string
  error?: string
}
export async function getProviderAuthStatus(
  baseUrl: string,
  token: string,
  provider: Provider,
  onTokenRefresh: (token: string) => void,
): Promise<ProviderAuthStatus> {
  const body = (await fetchJson(baseUrl, `/api/providers/${provider}/auth/status`, {
    token,
    onTokenRefresh,
    timeoutMs: 10000,
  })) as { data?: ProviderAuthStatus } & ProviderAuthStatus
  return body.data ?? body
}

/** Toggles a project's starred flag; returns the new state. */
export async function toggleProjectStar(
  baseUrl: string,
  token: string,
  projectId: string,
  onTokenRefresh: (token: string) => void,
): Promise<boolean> {
  const body = (await fetchJson(baseUrl, `/api/projects/${encodeURIComponent(projectId)}/toggle-star`, {
    method: 'POST',
    token,
    onTokenRefresh,
    timeoutMs: 10000,
  })) as { success: boolean; isStarred: boolean }
  return body.isStarred
}

/** Full recursive file tree for a project (absolute paths, ignores node_modules/.git/etc). */
export async function getFileTree(
  baseUrl: string,
  token: string,
  projectId: string,
  onTokenRefresh: (token: string) => void,
): Promise<FileNode[]> {
  return (await fetchJson(baseUrl, `/api/projects/${encodeURIComponent(projectId)}/files`, {
    token,
    onTokenRefresh,
    timeoutMs: 15000,
  })) as FileNode[]
}

export interface ProjectFileUploadResult {
  files: { name: string; path: string; size: number; mimeType: string }[]
  uploadedCount: number
  requestedFileCount: number
  targetPath: string
}

/** Uploads binary-safe files into a project folder through the host multipart route. */
export function uploadProjectFiles(
  baseUrl: string,
  token: string,
  projectId: string,
  options: {
    files: File[]
    targetPath: string
    overwrite: boolean
    onProgress: (percent: number) => void
    onTokenRefresh: (token: string) => void
    signal?: AbortSignal
  },
): Promise<ProjectFileUploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    for (const file of options.files) form.append('files', file)
    form.append('targetPath', options.targetPath)
    form.append('requestedFileCount', String(options.files.length))
    form.append('overwrite', String(options.overwrite))

    const xhr = new XMLHttpRequest()
    let settled = false
    const cleanup = () => options.signal?.removeEventListener('abort', abort)
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const abort = () => xhr.abort()

    xhr.open(
      'POST',
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/files/upload`,
    )
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.timeout = 5 * 60 * 1000
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
      }
    }
    xhr.onload = () => {
      finish(() => {
        const refreshed = xhr.getResponseHeader('X-Refreshed-Token')
        if (refreshed) options.onTokenRefresh(refreshed)
        let body: unknown = {}
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          // The status code below still provides a useful fallback error.
        }
        const message = apiErrorMessage(body)
        if (xhr.status === 401 || xhr.status === 403) {
          reject(new AuthError(message))
          return
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(message ?? `Upload failed (${xhr.status})`))
          return
        }
        const result = body as Partial<ProjectFileUploadResult>
        if (
          !Array.isArray(result.files) ||
          result.uploadedCount !== options.files.length ||
          result.requestedFileCount !== options.files.length ||
          typeof result.targetPath !== 'string'
        ) {
          reject(new Error('Host reported an incomplete file upload'))
          return
        }
        options.onProgress(100)
        resolve(result as ProjectFileUploadResult)
      })
    }
    xhr.onerror = () => finish(() => reject(new HostUnreachableError(baseUrl)))
    xhr.ontimeout = () => finish(() => reject(new Error('File upload timed out')))
    xhr.onabort = () =>
      finish(() => reject(new DOMException('File upload cancelled', 'AbortError')))

    if (options.signal?.aborted) {
      finish(() => reject(new DOMException('File upload cancelled', 'AbortError')))
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    xhr.send(form)
  })
}

/**
 * Custom slash commands from the host's `.claude/commands/` (project + user).
 * The response also lists CloudCLI's built-ins (/help, /models, …) — those are
 * features of CloudCLI's own frontend, not the agent, so we drop them.
 */
export async function getSlashCommands(
  baseUrl: string,
  token: string,
  projectPath: string,
  onTokenRefresh: (token: string) => void,
): Promise<SlashCommand[]> {
  const body = (await fetchJson(baseUrl, '/api/commands/list', {
    method: 'POST',
    token,
    body: { projectPath },
    onTokenRefresh,
    timeoutMs: 10000,
  })) as { custom?: { name: string; description?: string }[] }
  return (body.custom ?? []).map((command) => ({
    name: command.name,
    description: command.description ?? '',
    kind: 'command' as const,
  }))
}

/** Skills (SKILL.md, project + user scope) a provider can invoke as `/name`. */
export async function getSkills(
  baseUrl: string,
  token: string,
  provider: Provider,
  workspacePath: string,
  onTokenRefresh: (token: string) => void,
): Promise<SlashCommand[]> {
  const body = (await fetchJson(
    baseUrl,
    `/api/providers/${provider}/skills?workspacePath=${encodeURIComponent(workspacePath)}`,
    { token, onTokenRefresh, timeoutMs: 10000 },
  )) as { success: boolean; data: { skills?: { command: string; description?: string; scope?: string }[] } }
  return (body.data.skills ?? []).map((skill) => ({
    name: skill.command,
    description: skill.description ?? '',
    kind: 'skill' as const,
    scope: skill.scope,
  }))
}

/**
 * Uploads chat image attachments (multipart field `images`, max 5 × 5MB) into
 * the host's global asset store. The returned absolute paths go into
 * `chat.send` options.images and come back on history messages.
 */
export async function uploadImages(
  baseUrl: string,
  token: string,
  files: File[],
  onTokenRefresh: (token: string) => void,
): Promise<StoredImage[]> {
  const form = new FormData()
  for (const file of files) form.append('images', file)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  let res: Response
  try {
    // Raw fetch: FormData must set its own multipart boundary header.
    res = await fetch(`${baseUrl}/api/assets/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: controller.signal,
    })
  } catch {
    throw new HostUnreachableError(baseUrl)
  } finally {
    clearTimeout(timer)
  }
  const refreshed = res.headers.get('X-Refreshed-Token')
  if (refreshed) onTokenRefresh(refreshed)
  if (res.status === 401 || res.status === 403) throw new AuthError()
  const body = (await res.json().catch(() => ({}))) as { images?: StoredImage[]; error?: string }
  if (!res.ok) throw new Error(body.error ?? `Upload failed (${res.status})`)
  return body.images ?? []
}

// ----------------- Git -----------------
// The /api/git routes return bare JSON, and several report failures as
// HTTP 200 with an {error} body — so every response is checked here.

interface GitAuth {
  token: string
  onTokenRefresh: (token: string) => void
}

async function gitJson<T extends object>(
  baseUrl: string,
  path: string,
  auth: GitAuth,
  opts: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const body = (await fetchJson(baseUrl, `/api/git${path}`, {
    token: auth.token,
    onTokenRefresh: auth.onTokenRefresh,
    method: opts.method,
    body: opts.body,
    timeoutMs: opts.timeoutMs ?? 15000,
  })) as T & { error?: unknown }
  if (body && typeof body.error === 'string' && body.error) throw new Error(body.error)
  return body
}

export async function getGitStatus(
  baseUrl: string,
  projectId: string,
  auth: GitAuth,
): Promise<GitStatus> {
  return gitJson<GitStatus>(baseUrl, `/status?project=${encodeURIComponent(projectId)}`, auth)
}

/** Unified diff text for one file (worktree vs index, else index vs HEAD; untracked = all adds). */
export async function getGitDiff(
  baseUrl: string,
  projectId: string,
  filePath: string,
  auth: GitAuth,
): Promise<string> {
  const body = await gitJson<{ diff?: string }>(
    baseUrl,
    `/diff?project=${encodeURIComponent(projectId)}&file=${encodeURIComponent(filePath)}`,
    auth,
  )
  return body.diff ?? ''
}

export async function gitStage(
  baseUrl: string,
  projectId: string,
  files: string[],
  auth: GitAuth,
): Promise<void> {
  await gitJson(baseUrl, '/stage', auth, { method: 'POST', body: { project: projectId, files } })
}

export async function gitUnstage(
  baseUrl: string,
  projectId: string,
  files: string[],
  auth: GitAuth,
): Promise<void> {
  await gitJson(baseUrl, '/unstage', auth, { method: 'POST', body: { project: projectId, files } })
}

/** Stages the given files and commits them with the message. */
export async function gitCommit(
  baseUrl: string,
  projectId: string,
  message: string,
  files: string[],
  auth: GitAuth,
): Promise<string> {
  const body = await gitJson<{ output?: string }>(baseUrl, '/commit', auth, {
    method: 'POST',
    body: { project: projectId, message, files },
    timeoutMs: 30000,
  })
  return body.output ?? ''
}

export async function getGitBranches(
  baseUrl: string,
  projectId: string,
  auth: GitAuth,
): Promise<GitBranches> {
  return gitJson<GitBranches>(baseUrl, `/branches?project=${encodeURIComponent(projectId)}`, auth)
}

export async function gitCheckout(
  baseUrl: string,
  projectId: string,
  branch: string,
  auth: GitAuth,
): Promise<void> {
  await gitJson(baseUrl, '/checkout', auth, { method: 'POST', body: { project: projectId, branch } })
}

export async function gitCreateBranch(
  baseUrl: string,
  projectId: string,
  branch: string,
  auth: GitAuth,
): Promise<void> {
  await gitJson(baseUrl, '/create-branch', auth, {
    method: 'POST',
    body: { project: projectId, branch },
  })
}

export async function getGitRemoteStatus(
  baseUrl: string,
  projectId: string,
  auth: GitAuth,
): Promise<GitRemoteStatus> {
  return gitJson<GitRemoteStatus>(
    baseUrl,
    `/remote-status?project=${encodeURIComponent(projectId)}`,
    auth,
    { timeoutMs: 30000 },
  )
}

/** Recent commits across local branches, remotes, and tags in topological order. */
export async function getGitCommits(
  baseUrl: string,
  projectId: string,
  limit: number,
  auth: GitAuth,
): Promise<GitCommitSummary[]> {
  const body = await gitJson<{ commits?: GitCommitSummary[] }>(
    baseUrl,
    `/commits?project=${encodeURIComponent(projectId)}&limit=${encodeURIComponent(limit)}`,
    auth,
  )
  return body.commits ?? []
}

/** Unified patch for one commit; large responses are truncated host-side. */
export async function getGitCommitDiff(
  baseUrl: string,
  projectId: string,
  commit: string,
  auth: GitAuth,
): Promise<{ diff: string; isTruncated: boolean }> {
  const body = await gitJson<{ diff?: string; isTruncated?: boolean }>(
    baseUrl,
    `/commit-diff?project=${encodeURIComponent(projectId)}&commit=${encodeURIComponent(commit)}`,
    auth,
  )
  return { diff: body.diff ?? '', isTruncated: Boolean(body.isTruncated) }
}

/** action: fetch/pull/push track the upstream; publish pushes --set-upstream (needs branch). */
export async function gitRemoteAction(
  baseUrl: string,
  projectId: string,
  action: 'fetch' | 'pull' | 'push' | 'publish',
  auth: GitAuth,
  branch?: string,
): Promise<string> {
  const body = await gitJson<{ output?: string }>(baseUrl, `/${action}`, auth, {
    method: 'POST',
    body: action === 'publish' ? { project: projectId, branch } : { project: projectId },
    timeoutMs: 60000,
  })
  return body.output ?? ''
}

/** AI-generated conventional commit message for the given files' diffs. */
export async function generateCommitMessage(
  baseUrl: string,
  projectId: string,
  files: string[],
  auth: GitAuth,
): Promise<string> {
  const body = await gitJson<{ message?: string }>(baseUrl, '/generate-commit-message', auth, {
    method: 'POST',
    body: { project: projectId, files, provider: 'claude' },
    timeoutMs: 60000,
  })
  return body.message ?? ''
}

/** Reads a single file's UTF-8 text. */
export async function readFile(
  baseUrl: string,
  token: string,
  projectId: string,
  filePath: string,
  onTokenRefresh: (token: string) => void,
): Promise<string> {
  const body = (await fetchJson(
    baseUrl,
    `/api/projects/${encodeURIComponent(projectId)}/file?filePath=${encodeURIComponent(filePath)}`,
    { token, onTokenRefresh, timeoutMs: 15000 },
  )) as { content: string; path: string }
  return body.content
}

/** Saves UTF-8 text to a file (overwrites; does not create parent dirs). */
export async function saveFile(
  baseUrl: string,
  token: string,
  projectId: string,
  filePath: string,
  content: string,
  onTokenRefresh: (token: string) => void,
): Promise<void> {
  await fetchJson(baseUrl, `/api/projects/${encodeURIComponent(projectId)}/file`, {
    method: 'PUT',
    token,
    body: { filePath, content },
    onTokenRefresh,
    timeoutMs: 15000,
  })
}

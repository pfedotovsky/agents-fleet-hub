import type {
  FileNode,
  MessagesPage,
  ModelCatalog,
  ModelOption,
  Project,
  Provider,
  SessionSummary,
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
      .then((body) => (body as { error?: string }).error)
      .catch(() => undefined)
    throw new AuthError(message)
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function getAuthStatus(baseUrl: string): Promise<{ needsSetup: boolean }> {
  return (await fetchJson(baseUrl, '/api/auth/status')) as { needsSetup: boolean }
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

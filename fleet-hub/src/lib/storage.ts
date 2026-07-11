import type { HostConfig, Prefs } from '../types'

const HOSTS_KEY = 'fleethub.v1.hosts'
const TOKENS_KEY = 'fleethub.v1.tokens'
const PREFS_KEY = 'fleethub.v1.prefs'
const RECENT_KEY = 'fleethub.v1.recentProjects'
const MODEL_KEY = 'fleethub.v1.models'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function normalizeBaseUrl(url: string): string {
  let normalized = url.trim()
  if (!/^https?:\/\//i.test(normalized)) normalized = `http://${normalized}`
  return normalized.replace(/\/+$/, '')
}

export function loadHosts(): HostConfig[] {
  return readJson<HostConfig[]>(HOSTS_KEY, [])
}

export function saveHosts(hosts: HostConfig[]): void {
  localStorage.setItem(HOSTS_KEY, JSON.stringify(hosts))
}

function loadTokens(): Record<string, string> {
  return readJson<Record<string, string>>(TOKENS_KEY, {})
}

export function getToken(hostId: string): string | undefined {
  return loadTokens()[hostId]
}

export function saveToken(hostId: string, token: string): void {
  const tokens = loadTokens()
  tokens[hostId] = token
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
}

export function deleteToken(hostId: string): void {
  const tokens = loadTokens()
  delete tokens[hostId]
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
}

export function clearTokens(): void {
  localStorage.removeItem(TOKENS_KEY)
}

export function loadPrefs(): Prefs {
  return readJson<Prefs>(PREFS_KEY, { hideCursor: false })
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

/** Client-side "last opened in the hub" timestamps, keyed `hostId:projectId`. */
export function loadRecentProjects(): Record<string, number> {
  return readJson<Record<string, number>>(RECENT_KEY, {})
}

export function markProjectOpened(hostId: string, projectId: string, at: number): void {
  const recent = loadRecentProjects()
  recent[`${hostId}:${projectId}`] = at
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
}

/** Per-host chosen model+effort for chat.send, keyed by hostId. */
export interface ModelChoice {
  model: string
  effort?: string
}
export function loadModelChoice(hostId: string): ModelChoice | undefined {
  return readJson<Record<string, ModelChoice>>(MODEL_KEY, {})[hostId]
}
export function saveModelChoice(hostId: string, choice: ModelChoice): void {
  const all = readJson<Record<string, ModelChoice>>(MODEL_KEY, {})
  all[hostId] = choice
  localStorage.setItem(MODEL_KEY, JSON.stringify(all))
}

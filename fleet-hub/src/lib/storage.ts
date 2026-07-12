import type { HostConfig, PermissionMode, Prefs } from '../types'

const HOSTS_KEY = 'fleethub.v1.hosts'
const TOKENS_KEY = 'fleethub.v1.tokens'
const PREFS_KEY = 'fleethub.v1.prefs'
const RECENT_KEY = 'fleethub.v1.recentProjects'
const MODEL_KEY = 'fleethub.v1.models'
const PERMISSIONS_KEY = 'fleethub.v1.permissions'
const PERMISSION_MODES_KEY = 'fleethub.v1.permissionModes'
const SIDEBAR_WIDTH_KEY = 'fleethub.v1.sidebarWidth'
const DRAFTS_KEY = 'fleethub.v1.drafts'
const CHAT_PANEL_KEY = 'fleethub.v1.chatPanel'

export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 480
const SIDEBAR_DEFAULT_WIDTH = 288

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
  return { hideCursor: false, soundAlerts: true, ...readJson<Partial<Prefs>>(PREFS_KEY, {}) }
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

/**
 * Per host+project chat permissions, keyed `hostId:projectPath`. `allowedTools`
 * holds server permission-rule tokens (`Edit`, `Bash(git:*)`, …) granted via
 * "Always allow" — CloudCLI keeps rememberEntry grants only for the in-flight
 * query, so the hub must re-send them as toolsSettings on every chat.send.
 */
export interface ProjectPermissions {
  mode?: PermissionMode
  allowedTools?: string[]
}

function loadAllPermissions(): Record<string, ProjectPermissions> {
  return readJson<Record<string, ProjectPermissions>>(PERMISSIONS_KEY, {})
}

export function loadPermissions(hostId: string, projectPath: string): ProjectPermissions {
  return loadAllPermissions()[`${hostId}:${projectPath}`] ?? {}
}

/**
 * Permission mode is a per-host-instance choice (the same VM is trusted the
 * same way across its projects), keyed by hostId. Reads fall back to the
 * legacy per-project `ProjectPermissions.mode` written by earlier builds.
 */
export function loadPermissionMode(hostId: string, projectPath: string): PermissionMode | undefined {
  const perHost = readJson<Record<string, PermissionMode>>(PERMISSION_MODES_KEY, {})[hostId]
  return perHost ?? loadPermissions(hostId, projectPath).mode
}

export function savePermissionMode(hostId: string, mode: PermissionMode): void {
  const all = readJson<Record<string, PermissionMode>>(PERMISSION_MODES_KEY, {})
  all[hostId] = mode
  localStorage.setItem(PERMISSION_MODES_KEY, JSON.stringify(all))
}

/** The chat's right-hand utility panel (files / git), Cursor-style. */
export type ChatPanelKind = 'files' | 'git'

export const CHAT_PANEL_MIN_WIDTH = 480
const CHAT_PANEL_DEFAULT_WIDTH = 620

export interface ChatPanelState {
  kind: ChatPanelKind | null
  width: number
}

export function loadChatPanel(): ChatPanelState {
  const state = readJson<Partial<ChatPanelState>>(CHAT_PANEL_KEY, {})
  return {
    kind: state.kind === 'files' || state.kind === 'git' ? state.kind : null,
    width: Math.max(
      CHAT_PANEL_MIN_WIDTH,
      typeof state.width === 'number' ? state.width : CHAT_PANEL_DEFAULT_WIDTH,
    ),
  }
}

export function saveChatPanel(state: ChatPanelState): void {
  localStorage.setItem(CHAT_PANEL_KEY, JSON.stringify(state))
}

export function loadSidebarWidth(): number {
  const width = readJson<number>(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT_WIDTH)
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width))
}

export function saveSidebarWidth(width: number): void {
  localStorage.setItem(SIDEBAR_WIDTH_KEY, JSON.stringify(width))
}

/** Unsent chat input, keyed `hostId:sessionId`, so drafts survive switching chats. */
export function loadDraft(hostId: string, sessionId: string): string {
  return readJson<Record<string, string>>(DRAFTS_KEY, {})[`${hostId}:${sessionId}`] ?? ''
}

export function saveDraft(hostId: string, sessionId: string, text: string): void {
  const drafts = readJson<Record<string, string>>(DRAFTS_KEY, {})
  const key = `${hostId}:${sessionId}`
  if (text) drafts[key] = text
  else delete drafts[key]
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
}

/** Adds an "Always allow" rule token; returns the updated list. */
export function addAllowedTool(hostId: string, projectPath: string, entry: string): string[] {
  const all = loadAllPermissions()
  const key = `${hostId}:${projectPath}`
  const current = all[key]?.allowedTools ?? []
  const allowedTools = current.includes(entry) ? current : [...current, entry]
  all[key] = { ...all[key], allowedTools }
  localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(all))
  return allowedTools
}

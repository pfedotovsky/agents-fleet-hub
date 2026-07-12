import type { HostConfig, PermissionMode, Prefs } from '../types'

const HOSTS_KEY = 'fleethub.v1.hosts'
const TOKENS_KEY = 'fleethub.v1.tokens'
const PREFS_KEY = 'fleethub.v1.prefs'
const RECENT_KEY = 'fleethub.v1.recentProjects'
const MODEL_KEY = 'fleethub.v1.models'
const PERMISSIONS_KEY = 'fleethub.v1.permissions'
const PERMISSION_MODES_KEY = 'fleethub.v1.permissionModes'
const PLAN_MODE_KEY = 'fleethub.v1.planMode'
const SIDEBAR_WIDTH_KEY = 'fleethub.v1.sidebarWidth'
const DRAFTS_KEY = 'fleethub.v1.drafts'
const CHAT_PANEL_KEY = 'fleethub.v1.chatPanel'
const LAST_PROVIDER_KEY = 'fleethub.v1.lastProvider'
const AUTO_ADDED_KEY = 'fleethub.v1.autoAdded'

export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 480
const SIDEBAR_DEFAULT_WIDTH = 304

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

/**
 * Base URLs the app auto-added on launch (the local fleet-server). Recorded so
 * that removing the host in Settings sticks — we never re-add a URL that's
 * already here, even after the user deletes it.
 */
export function loadAutoAdded(): string[] {
  return readJson<string[]>(AUTO_ADDED_KEY, [])
}

export function addAutoAdded(baseUrl: string): void {
  const all = loadAutoAdded()
  if (!all.includes(baseUrl)) {
    localStorage.setItem(AUTO_ADDED_KEY, JSON.stringify([...all, baseUrl]))
  }
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

/**
 * Provider last used to create a session on a host — the default for the
 * project pane's picker and the sidebar's quick-create "+".
 */
export function loadLastProvider(hostId: string): string | undefined {
  return readJson<Record<string, string>>(LAST_PROVIDER_KEY, {})[hostId]
}
export function saveLastProvider(hostId: string, provider: string): void {
  const all = readJson<Record<string, string>>(LAST_PROVIDER_KEY, {})
  all[hostId] = provider
  localStorage.setItem(LAST_PROVIDER_KEY, JSON.stringify(all))
}

/**
 * Chosen model+effort for chat.send, keyed `hostId:provider` — Claude and
 * Codex catalogs don't overlap, so a shared per-host choice would send one
 * provider's model id to the other. Legacy bare-hostId entries (written
 * before Codex support) were always Claude models, hence the claude-only
 * fallback read.
 */
export interface ModelChoice {
  model: string
  effort?: string
}
export function loadModelChoice(hostId: string, provider: string): ModelChoice | undefined {
  const all = readJson<Record<string, ModelChoice>>(MODEL_KEY, {})
  return all[`${hostId}:${provider}`] ?? (provider === 'claude' ? all[hostId] : undefined)
}
export function saveModelChoice(hostId: string, provider: string, choice: ModelChoice): void {
  const all = readJson<Record<string, ModelChoice>>(MODEL_KEY, {})
  all[`${hostId}:${provider}`] = choice
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

/**
 * Plan mode is a separate toggle (Shift+Tab in the composer), not one of the
 * permission modes, keyed by hostId like the permission mode. Reads fall back
 * to a legacy `permissionMode === 'plan'` in the caller.
 */
export function loadPlanMode(hostId: string): boolean | undefined {
  return readJson<Record<string, boolean>>(PLAN_MODE_KEY, {})[hostId]
}

export function savePlanMode(hostId: string, on: boolean): void {
  const all = readJson<Record<string, boolean>>(PLAN_MODE_KEY, {})
  all[hostId] = on
  localStorage.setItem(PLAN_MODE_KEY, JSON.stringify(all))
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

export type Provider = 'claude' | 'codex' | 'cursor' | 'opencode'

export type HostStatus = 'loading' | 'online' | 'offline' | 'needs-auth' | 'needs-setup'

export interface HostConfig {
  id: string
  name: string
  baseUrl: string
  username?: string
}

export interface SessionSummary {
  id: string
  provider: Provider
  summary: string
  /** Hardcoded to 0 by CloudCLI 1.36.1 — never render it. */
  messageCount: number
  lastActivity: string
}

export interface Project {
  projectId: string
  path: string
  displayName: string
  fullPath: string
  isStarred: boolean
  sessions: SessionSummary[]
  sessionMeta: { hasMore: boolean; total: number }
}

export interface HostRuntime {
  config: HostConfig
  status: HostStatus
  projects: Project[]
  lastError?: string
  lastSuccessAt?: number
}

export interface FleetSession {
  key: string
  hostId: string
  hostName: string
  hostColorIdx: number
  baseUrl: string
  projectName: string
  projectPath: string
  session: SessionSummary
  href: string
  stale: boolean
  justUpdated: boolean
}

export interface Prefs {
  hideCursor: boolean
}

/** Provider-normalized transcript message from GET /api/providers/sessions/:id/messages. */
export interface NormalizedMessage {
  id: string
  sessionId: string
  timestamp: string
  provider: string
  kind: 'text' | 'tool_use' | 'thinking' | 'tool_result' | 'error' | (string & {})
  role?: 'user' | 'assistant' | (string & {})
  content?: unknown
  toolName?: string
  toolInput?: unknown
  toolId?: string
  toolResult?: { content: string; isError?: boolean }
}

export interface MessagesPage {
  messages: NormalizedMessage[]
  total: number
  hasMore: boolean
  offset: number
  limit: number | null
}

export interface PermissionRequest {
  requestId: string
  toolName?: string
  input?: unknown
}

/** Any frame arriving on the chat WebSocket — a NormalizedMessage or a gateway event. */
export interface ChatEvent extends NormalizedMessage {
  seq?: number
  requestId?: string
  input?: unknown
  reason?: string
  exitCode?: number
  success?: boolean
  aborted?: boolean
  isProcessing?: boolean
  lastSeq?: number
  pendingPermissions?: PermissionRequest[]
  code?: string
  error?: string
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface EffortOption {
  value: string
}
export interface ModelOption {
  value: string
  label: string
  description?: string
  effort?: { default: string; values: EffortOption[] }
}
export interface ModelCatalog {
  options: ModelOption[]
  default: string
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modified?: string | null
  isSymlink?: boolean
  children?: FileNode[]
}

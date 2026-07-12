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
  /**
   * Session ids currently processing, from GET /sessions/running.
   * Undefined when the host didn't report (older CloudCLI or fetch error) —
   * consumers then fall back to the lastActivity heuristic.
   */
  runningSessionIds?: ReadonlySet<string>
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
  projectId: string
  session: SessionSummary
  href: string
  stale: boolean
  justUpdated: boolean
  /** Host-reported "agent is processing"; undefined = host didn't report (use the heuristic). */
  running?: boolean
}

/** One row from GET /api/providers/sessions/archived. */
export interface ArchivedSession {
  sessionId: string
  provider: Provider
  projectId: string | null
  projectPath: string | null
  projectDisplayName: string
  sessionTitle: string
  createdAt: string | null
  updatedAt: string | null
  lastActivity: string | null
  isProjectArchived: boolean
}

export interface Prefs {
  hideCursor: boolean
  /** Chime + desktop notification when a run finishes or asks for permission. */
  soundAlerts: boolean
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
  /**
   * Codex live tool_use frames carry the result inline instead of a separate
   * tool_result frame (command_execution → output/exitCode, plus a
   * running/completed/failed item status).
   */
  output?: string
  exitCode?: number
  status?: string
  /**
   * Image attachments on user messages. Hub-sent images are stored-asset
   * paths in ~/.cloudcli/assets; messages sent from CloudCLI's own UI carry
   * inline `data:` URLs instead of a path.
   */
  images?: { path?: string; name?: string; data?: string }[]
}

/** One uploaded chat image, as returned by POST /api/assets/images. */
export interface StoredImage {
  name: string
  path: string
  size: number
  mimeType: string
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

export interface AskUserQuestionOption {
  label: string
  description?: string
}

/** One question from an AskUserQuestion permission request (`input.questions`). */
export interface AskUserQuestionSpec {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

/** Any frame arriving on the chat WebSocket — a NormalizedMessage or a gateway event. */
export interface ChatEvent extends NormalizedMessage {
  seq?: number
  requestId?: string
  input?: unknown
  reason?: string
  success?: boolean
  /** Codex emits a `status` frame with text 'token_budget' after each turn. */
  text?: string
  tokenBudget?: { used?: number; total?: number; inputTokens?: number; outputTokens?: number }
  aborted?: boolean
  isProcessing?: boolean
  lastSeq?: number
  pendingPermissions?: PermissionRequest[]
  code?: string
  error?: string
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

/** Outcome of reviewing a finished plan (ExitPlanMode request). */
export type PlanDecision = 'build' | 'acceptEdits' | 'revise'

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

/** A `/` composer completion: a skill (SKILL.md) or a custom command (.claude/commands). */
export interface SlashCommand {
  /** Includes the leading slash, e.g. `/impeccable`. */
  name: string
  description: string
  kind: 'skill' | 'command'
  /** 'user' | 'project' (skills only). */
  scope?: string
}

/** GET /api/git/status. A file with staged AND unstaged edits appears in both lists. */
export interface GitStatus {
  branch: string
  hasCommits: boolean
  modified: string[]
  added: string[]
  deleted: string[]
  untracked: string[]
  staged: string[]
}

export interface GitBranches {
  branches: string[]
  localBranches: string[]
  remoteBranches: string[]
}

export interface GitRemoteStatus {
  hasRemote: boolean
  hasUpstream: boolean
  branch: string
  remoteName: string | null
  ahead: number
  behind: number
  isUpToDate: boolean
  message?: string
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronUp,
  CircleStop,
  ClipboardList,
  ExternalLink,
  File,
  ImagePlus,
  LoaderCircle,
  ShieldQuestion,
  Sparkles,
  SquareSlash,
  TriangleAlert,
  X,
} from 'lucide-react'
import type {
  ChatEvent,
  FleetSession,
  ModelOption,
  NormalizedMessage,
  PermissionMode,
  PermissionRequest,
} from '../types'
import {
  AuthError,
  HostUnreachableError,
  getModels,
  getSessionMessages,
  readFile,
  saveFile,
  uploadImages,
} from '../lib/api'
import { ChatSocket } from '../lib/chatSocket'
import type { SocketState } from '../lib/chatSocket'
import {
  addAllowedTool,
  getToken,
  loadDraft,
  loadModelChoice,
  loadPermissionMode,
  loadPermissions,
  saveDraft,
  saveModelChoice,
  savePermissionMode,
  saveToken,
} from '../lib/storage'
import { notify, requestNotifyPermission } from '../lib/notify'
import { hostColor } from '../lib/format'
import { useComposerAutocomplete } from '../hooks/useComposerAutocomplete'
import type { CompletionItem } from '../hooks/useComposerAutocomplete'
import { MessageItem, RENDERED_KINDS, ProviderBadge, contentToText } from './Messages'
import { Markdown } from './Markdown'
import { seedImageCache } from './AuthedImage'

const PAGE_SIZE = 100

/** Mirrors the host's upload limits (multer: 5 files × 5MB, image types only). */
const MAX_IMAGES = 5
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

/** One composer attachment; uploaded to the host as soon as it's added. */
interface PendingImage {
  id: number
  name: string
  mimeType: string
  previewUrl: string
  status: 'uploading' | 'ready' | 'error'
  /** Stored-asset path on the host, once uploaded. */
  path?: string
}

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
  { value: 'default', label: 'Ask for permissions' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'plan', label: 'Plan mode' },
  { value: 'bypassPermissions', label: 'Bypass permissions' },
]

/**
 * ExitPlanMode arrives as a regular permission_request (the server marks it
 * interactive, so it reaches the UI even when other tools are auto-allowed).
 * It gets the plan-review card instead of the generic allow/deny prompt.
 */
function isPlanRequest(request: PermissionRequest): boolean {
  return request.toolName === 'ExitPlanMode' || request.toolName === 'exit_plan_mode'
}

export type PlanDecision = 'build' | 'acceptEdits' | 'revise'

function PlanApprovalCard({
  request,
  onDecide,
}: {
  request: PermissionRequest
  onDecide: (requestId: string, decision: PlanDecision) => void
}) {
  const input = request.input as { plan?: unknown } | null | undefined
  const plan = typeof input?.plan === 'string' ? input.plan : ''
  return (
    <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-indigo-300">
        <ClipboardList size={14} />
        Plan ready for review
      </div>
      {plan && (
        <div className="mb-3 max-h-96 overflow-auto rounded-md border border-ink-800 bg-ink-950/60 p-3 text-[13px]">
          <Markdown>{plan}</Markdown>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onDecide(request.requestId, 'build')}
          className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
        >
          <Check size={12} /> Approve &amp; build
        </button>
        <button
          type="button"
          onClick={() => onDecide(request.requestId, 'acceptEdits')}
          title="Approve the plan and auto-accept file edits during the build"
          className="inline-flex items-center gap-1 rounded-md border border-indigo-500/50 px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-600/10"
        >
          <Check size={12} /> Approve, auto-accept edits
        </button>
        <button
          type="button"
          onClick={() => onDecide(request.requestId, 'revise')}
          className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:bg-ink-800"
        >
          <X size={12} /> Revise
        </button>
      </div>
    </div>
  )
}

/**
 * Server permission-rule token for "Always allow": the bare tool name, or a
 * `Bash(<first word>:*)` prefix rule — the only two shapes CloudCLI's
 * matchesToolPermission understands.
 */
function rememberEntryFor(request: PermissionRequest): string | undefined {
  if (!request.toolName) return undefined
  if (request.toolName !== 'Bash') return request.toolName
  const input = request.input as { command?: unknown } | string | null | undefined
  const command =
    typeof input === 'string' ? input : typeof input?.command === 'string' ? input.command : ''
  const firstWord = command.trim().split(/\s+/)[0]
  return firstWord ? `Bash(${firstWord}:*)` : 'Bash'
}

function PermissionCard({
  request,
  onRespond,
}: {
  request: PermissionRequest
  onRespond: (requestId: string, allow: boolean, rememberEntry?: string) => void
}) {
  const rememberEntry = rememberEntryFor(request)
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-amber-300">
        <ShieldQuestion size={14} />
        Permission requested: <span className="font-mono">{request.toolName ?? 'tool'}</span>
      </div>
      {request.input !== undefined && (
        <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-ink-950/60 p-2 font-mono text-xs text-ink-400">
          {contentToText(request.input)}
        </pre>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onRespond(request.requestId, true)}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <Check size={12} /> Allow
        </button>
        {rememberEntry && (
          <button
            type="button"
            onClick={() => onRespond(request.requestId, true, rememberEntry)}
            title={`Stop asking for ${rememberEntry} in this project`}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-600/50 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-600/10"
          >
            <Check size={12} /> Always allow <span className="font-mono">{rememberEntry}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onRespond(request.requestId, false)}
          className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:bg-ink-800"
        >
          <X size={12} /> Deny
        </button>
      </div>
    </div>
  )
}

const COMPLETION_ICONS = { file: File, skill: Sparkles, command: SquareSlash } as const
const COMPLETION_TAGS = { file: 'file', skill: 'skill', command: 'command' } as const

function CompletionMenu({
  items,
  selected,
  onHover,
  onPick,
}: {
  items: CompletionItem[]
  selected: number
  onHover: (index: number) => void
  onPick: (item: CompletionItem) => void
}) {
  return (
    <div className="absolute inset-x-0 bottom-full z-10 mb-2 max-h-72 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 py-1 shadow-2xl">
      {items.map((item, index) => {
        const Icon = COMPLETION_ICONS[item.kind]
        return (
          <button
            key={`${item.kind}:${item.label}`}
            type="button"
            // mousedown + preventDefault keeps focus in the textarea
            onMouseDown={(event) => {
              event.preventDefault()
              onPick(item)
            }}
            onMouseEnter={() => onHover(index)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
              index === selected ? 'bg-ink-800 text-ink-100' : 'text-ink-300'
            }`}
          >
            <Icon size={13} className="shrink-0 text-ink-500" />
            <span className="shrink-0 font-mono">{item.label}</span>
            {item.detail && <span className="min-w-0 truncate text-xs text-ink-500">{item.detail}</span>}
            <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-ink-600">
              {COMPLETION_TAGS[item.kind]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

interface Props {
  target: FleetSession
  onBack: () => void
}

export function ChatPane({ target, onBack }: Props) {
  const sessionId = target.session.id
  const [messages, setMessages] = useState<NormalizedMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [socketState, setSocketState] = useState<SocketState>('connecting')
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [input, setInput] = useState(() => loadDraft(target.hostId, sessionId))
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    () => loadPermissionMode(target.hostId, target.projectPath) ?? 'default',
  )
  const [allowedTools, setAllowedTools] = useState<string[]>(
    () => loadPermissions(target.hostId, target.projectPath).allowedTools ?? [],
  )
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const imageCounter = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [model, setModel] = useState<string>(() => loadModelChoice(target.hostId)?.model ?? '')
  const [effort, setEffort] = useState<string>(() => loadModelChoice(target.hostId)?.effort ?? '')

  const [loadedOlder, setLoadedOlder] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const socketRef = useRef<ChatSocket | null>(null)
  const seenIds = useRef(new Set<string>())
  const lastSeq = useRef(0)
  const localCounter = useRef(0)
  const messagesRef = useRef<NormalizedMessage[]>([])
  messagesRef.current = messages
  const processingRef = useRef(false)
  processingRef.current = processing
  const loadedOlderRef = useRef(false)
  loadedOlderRef.current = loadedOlder
  const upsertTimer = useRef<number | undefined>(undefined)
  const notifiedPermissionIds = useRef(new Set<string>())

  // Size the textarea to fit a draft restored on mount.
  useEffect(() => {
    const el = textareaRef.current
    if (!el || !el.value) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Sticky autoscroll: `pinnedRef` tracks whether the user is at (or near) the
   * bottom, updated on every scroll. While pinned, a ResizeObserver on the
   * message column re-snaps to the bottom whenever content grows — including
   * async height changes (markdown, syntax highlighting, diffs) that land well
   * after the message frame arrived, which used to break autoscroll.
   */
  const pinnedRef = useRef(true)
  const contentRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback((onlyIfPinned: boolean) => {
    const el = scrollRef.current
    if (!el) return
    if (onlyIfPinned && !pinnedRef.current) return
    pinnedRef.current = true
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [loading, fatalError])

  const appendMessage = useCallback(
    (message: NormalizedMessage) => {
      if (message.id && seenIds.current.has(message.id)) return
      if (message.id) seenIds.current.add(message.id)
      setMessages((prev) => {
        // Live tool results arrive as separate frames — attach them to their tool_use.
        if (message.kind === 'tool_result' && message.toolId) {
          return prev.map((existing) =>
            existing.kind === 'tool_use' && existing.toolId === message.toolId
              ? {
                  ...existing,
                  toolResult: {
                    content: contentToText(message.content),
                    isError: Boolean((message as ChatEvent).error),
                  },
                }
              : existing,
          )
        }
        return [...prev, message]
      })
      scrollToBottom(true)
    },
    [scrollToBottom],
  )

  const fetchPage = useCallback(
    async (offset: number) => {
      const token = getToken(target.hostId)
      if (!token) throw new AuthError('Not signed in to this host in the hub')
      return getSessionMessages(
        target.baseUrl,
        token,
        sessionId,
        { limit: PAGE_SIZE, offset },
        (refreshed) => saveToken(target.hostId, refreshed),
      )
    },
    [target.baseUrl, target.hostId, sessionId],
  )

  /**
   * Pulls the newest history page and reconciles it into the transcript. This is
   * what keeps the chat live for runs the hub did NOT start (terminal Claude Code,
   * the host's own UI): those never stream to our socket — the server only
   * broadcasts `session_upserted` when its disk sync notices new activity.
   *
   * `replace` swaps the whole list for the canonical history (used after our own
   * run completes, since live-stream ids differ from history ids); merge appends
   * only unseen ids and drops optimistic local user bubbles the history now covers.
   */
  const mergeNewest = useCallback(
    async (replace: boolean) => {
      try {
        const page = await fetchPage(0)
        if (replace) {
          seenIds.current = new Set(
            page.messages.filter((m) => m.id).map((m) => m.id as string),
          )
          setMessages(page.messages)
          setHasMore(page.hasMore)
          scrollToBottom(true)
          return
        }
        const fresh = page.messages.filter((m) => !m.id || !seenIds.current.has(m.id))
        if (fresh.length === 0) return
        for (const message of fresh) {
          if (message.id) seenIds.current.add(message.id)
        }
        const freshUserTexts = new Set(
          fresh
            .filter((m) => m.kind === 'text' && m.role === 'user')
            .map((m) => contentToText(m.content)),
        )
        setMessages((prev) => {
          const kept = prev.filter(
            (m) =>
              !(
                m.id?.startsWith('local_') &&
                m.kind === 'text' &&
                freshUserTexts.has(contentToText(m.content))
              ),
          )
          return [...kept, ...fresh]
        })
        scrollToBottom(true)
      } catch {
        // Transient refresh failure — the next upsert/poll will retry.
      }
    },
    [fetchPage, scrollToBottom],
  )

  const handleEvent = useCallback(
    (event: ChatEvent) => {
      if (event.sessionId && event.sessionId !== sessionId && event.kind !== 'protocol_error') return
      if (typeof event.seq === 'number' && event.seq > lastSeq.current) lastSeq.current = event.seq

      switch (event.kind) {
        case 'chat_subscribed':
          setProcessing(Boolean(event.isProcessing))
          if (event.pendingPermissions?.length) {
            setPermissions((prev) => {
              const known = new Set(prev.map((p) => p.requestId))
              const fresh = event.pendingPermissions!.filter((p) => p?.requestId && !known.has(p.requestId))
              return [...prev, ...fresh]
            })
          }
          return
        case 'complete':
          if (processingRef.current) {
            notify(
              'done',
              `${target.projectName} — run finished`,
              target.session.summary || 'The agent completed its run.',
              `done:${sessionId}`,
            )
          }
          setProcessing(false)
          setPermissions([])
          // True-up from persisted history once the transcript flushes: replaces
          // live-stream ids with canonical ones (unless older pages are loaded).
          window.setTimeout(() => void mergeNewest(!loadedOlderRef.current), 800)
          return
        case 'permission_request':
          if (event.requestId) {
            const request: PermissionRequest = {
              requestId: event.requestId,
              toolName: event.toolName,
              input: event.input,
            }
            if (!notifiedPermissionIds.current.has(request.requestId)) {
              notifiedPermissionIds.current.add(request.requestId)
              if (isPlanRequest(request)) {
                notify(
                  'permission',
                  `${target.projectName} — plan ready`,
                  'The agent finished planning and is waiting for your review.',
                  `perm:${sessionId}`,
                )
              } else {
                notify(
                  'permission',
                  `${target.projectName} — permission needed`,
                  `The agent wants to use ${request.toolName ?? 'a tool'}.`,
                  `perm:${sessionId}`,
                )
              }
            }
            setPermissions((prev) =>
              prev.some((p) => p.requestId === request.requestId) ? prev : [...prev, request],
            )
            scrollToBottom(true)
          }
          return
        case 'permission_cancelled':
          setPermissions((prev) => prev.filter((p) => p.requestId !== event.requestId))
          return
        case 'protocol_error':
          setBanner(event.error ?? 'Protocol error')
          if (event.code === 'RUN_IN_PROGRESS') setProcessing(true)
          return
        case 'session_upserted':
          // Disk sync noticed activity on this session. If it's not our own live
          // run (which already streams here), pull the new messages. Debounced —
          // syncs fire in bursts.
          if (!processingRef.current) {
            window.clearTimeout(upsertTimer.current)
            upsertTimer.current = window.setTimeout(() => void mergeNewest(false), 500)
          }
          return
        case 'status':
        case 'loading_progress':
          return
        case 'action_required':
          appendMessage({ ...event, kind: 'error' })
          return
        default:
          if (event.kind === 'tool_result' || RENDERED_KINDS.has(event.kind)) {
            appendMessage(event)
          }
      }
    },
    [appendMessage, mergeNewest, scrollToBottom, sessionId, target.projectName, target.session.summary],
  )

  // History load + socket lifecycle, once per session target.
  useEffect(() => {
    seenIds.current = new Set()
    lastSeq.current = 0
    pinnedRef.current = true
    notifiedPermissionIds.current = new Set()
    setMessages([])
    setPermissions([])
    setBanner(null)
    setFatalError(null)
    setProcessing(false)
    setLoadedOlder(false)
    setLoading(true)

    let cancelled = false
    void (async () => {
      try {
        const page = await fetchPage(0)
        if (cancelled) return
        for (const message of page.messages) {
          if (message.id) seenIds.current.add(message.id)
        }
        setMessages(page.messages)
        setHasMore(page.hasMore)
      } catch (err) {
        if (cancelled) return
        if (err instanceof AuthError) {
          setFatalError('The hub token for this host expired — sign in again from the sidebar.')
        } else if (err instanceof HostUnreachableError) {
          setFatalError('Host is offline — the transcript cannot be loaded right now.')
        } else {
          setFatalError(err instanceof Error ? err.message : 'Failed to load the transcript')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          scrollToBottom(false)
        }
      }
    })()

    const socket = new ChatSocket(
      target.baseUrl,
      () => getToken(target.hostId),
      handleEvent,
      (state) => {
        setSocketState(state)
        if (state === 'open') socket.subscribe(sessionId, lastSeq.current)
      },
    )
    socketRef.current = socket
    socket.connect()

    return () => {
      cancelled = true
      window.clearTimeout(upsertTimer.current)
      socket.close()
      socketRef.current = null
    }
  }, [fetchPage, handleEvent, scrollToBottom, sessionId, target.baseUrl, target.hostId])

  // Fallback poll: covers a downed socket or missed upsert broadcasts. Cheap —
  // one page fetch, and mergeNewest no-ops when nothing is new.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!processingRef.current && document.visibilityState === 'visible') {
        void mergeNewest(false)
      }
    }, 15_000)
    return () => clearInterval(interval)
  }, [mergeNewest])

  // Model catalog for this session's provider (Cursor has none).
  useEffect(() => {
    if (target.session.provider === 'cursor') return
    const token = getToken(target.hostId)
    if (!token) return
    let cancelled = false
    void getModels(target.baseUrl, token, target.session.provider, (t) => saveToken(target.hostId, t))
      .then((catalog) => {
        if (cancelled) return
        setModelOptions(catalog.options)
        setModel((current) => current || loadModelChoice(target.hostId)?.model || catalog.default)
      })
      .catch(() => {
        /* model picker just stays empty if unavailable */
      })
    return () => {
      cancelled = true
    }
  }, [target.baseUrl, target.hostId, target.session.provider])

  const activeModel = useMemo(
    () => modelOptions.find((option) => option.value === model),
    [modelOptions, model],
  )

  function changeModel(value: string) {
    setModel(value)
    const nextEfforts = modelOptions.find((option) => option.value === value)?.effort
    const nextEffort = nextEfforts?.values.some((e) => e.value === effort) ? effort : ''
    setEffort(nextEffort)
    saveModelChoice(target.hostId, { model: value, effort: nextEffort || undefined })
  }

  function changeEffort(value: string) {
    setEffort(value)
    saveModelChoice(target.hostId, { model, effort: value || undefined })
  }

  async function loadOlder() {
    setLoadingOlder(true)
    setLoadedOlder(true)
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    try {
      const page = await fetchPage(messagesRef.current.length)
      const fresh = page.messages.filter((m) => !m.id || !seenIds.current.has(m.id))
      for (const message of fresh) {
        if (message.id) seenIds.current.add(message.id)
      }
      setMessages((prev) => [...fresh, ...prev])
      setHasMore(page.hasMore)
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight
      })
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to load older messages')
    } finally {
      setLoadingOlder(false)
    }
  }

  /**
   * Attaches image files: validates against the host's limits, shows chips
   * immediately with local previews, and uploads in one request. Paths land
   * on the chips when the upload finishes; send() only takes 'ready' ones.
   */
  function attachImages(files: File[]) {
    const token = getToken(target.hostId)
    if (!token) return
    const room = MAX_IMAGES - pendingImages.length
    const images = files.filter((file) => IMAGE_MIME_TYPES.has(file.type))
    if (images.length === 0) return
    const rejectedType = files.length - images.length
    const oversize = images.filter((file) => file.size > MAX_IMAGE_BYTES)
    const accepted = images.filter((file) => file.size <= MAX_IMAGE_BYTES).slice(0, Math.max(0, room))
    const dropped: string[] = []
    if (rejectedType > 0) dropped.push('unsupported type')
    if (oversize.length > 0) dropped.push('over 5MB')
    if (accepted.length < images.length - oversize.length) dropped.push(`max ${MAX_IMAGES} images`)
    setBanner(dropped.length > 0 ? `Some images were skipped (${dropped.join(', ')}).` : null)
    if (accepted.length === 0) return

    const chips: PendingImage[] = accepted.map((file) => {
      imageCounter.current += 1
      return {
        id: imageCounter.current,
        name: file.name,
        mimeType: file.type,
        previewUrl: URL.createObjectURL(file),
        status: 'uploading',
      }
    })
    setPendingImages((prev) => [...prev, ...chips])

    void uploadImages(target.baseUrl, token, accepted, (t) => saveToken(target.hostId, t))
      .then((stored) => {
        setPendingImages((prev) =>
          prev.map((chip) => {
            const index = chips.findIndex((c) => c.id === chip.id)
            if (index === -1) return chip
            const record = stored[index]
            if (!record) return { ...chip, status: 'error' as const }
            // The optimistic bubble and future history fetches can now reuse
            // the local preview instead of re-downloading the asset.
            seedImageCache(target.baseUrl, record.path, chip.previewUrl)
            return { ...chip, status: 'ready' as const, path: record.path }
          }),
        )
      })
      .catch((err) => {
        setPendingImages((prev) =>
          prev.map((chip) =>
            chips.some((c) => c.id === chip.id) ? { ...chip, status: 'error' as const } : chip,
          ),
        )
        setBanner(err instanceof Error ? err.message : 'Image upload failed')
      })
  }

  function removeImage(id: number) {
    setPendingImages((prev) => {
      const chip = prev.find((c) => c.id === id)
      // Only revoke previews that never made it into the image cache.
      if (chip && chip.status !== 'ready') URL.revokeObjectURL(chip.previewUrl)
      return prev.filter((c) => c.id !== id)
    })
  }

  const applyCompletion = useCallback(
    (next: string, caret: number) => {
      setInput(next)
      saveDraft(target.hostId, sessionId, next)
      const el = textareaRef.current
      if (el) {
        el.focus()
        requestAnimationFrame(() => {
          el.setSelectionRange(caret, caret)
          el.style.height = 'auto'
          el.style.height = `${Math.min(el.scrollHeight, 160)}px`
        })
      }
    },
    [sessionId, target.hostId],
  )
  const autocomplete = useComposerAutocomplete(target, applyCompletion)

  function send() {
    const text = input.trim()
    const socket = socketRef.current
    if (!text || processing || !socket) return
    if (pendingImages.some((chip) => chip.status === 'uploading')) {
      setBanner('Images are still uploading…')
      return
    }
    const readyImages = pendingImages.filter(
      (chip): chip is PendingImage & { path: string } => chip.status === 'ready' && !!chip.path,
    )
    const options: Parameters<ChatSocket['sendChat']>[2] = {}
    if (permissionMode !== 'default') options.permissionMode = permissionMode
    if (model) options.model = model
    if (effort) options.effort = effort
    if (allowedTools.length > 0) {
      options.toolsSettings = { allowedTools, disallowedTools: [], skipPermissions: false }
    }
    if (readyImages.length > 0) {
      options.images = readyImages.map((chip) => ({
        path: chip.path,
        name: chip.name,
        mimeType: chip.mimeType,
      }))
    }
    if (!socket.sendChat(sessionId, text, options)) {
      setBanner('Not connected to the host — reconnecting…')
      return
    }
    setBanner(null)
    requestNotifyPermission()
    localCounter.current += 1
    appendMessage({
      id: `local_${localCounter.current}`,
      sessionId,
      timestamp: new Date().toISOString(),
      provider: target.session.provider,
      kind: 'text',
      role: 'user',
      content: text,
      images: readyImages.map((chip) => ({ path: chip.path, name: chip.name })),
    })
    setProcessing(true)
    setInput('')
    setPendingImages([])
    autocomplete.close()
    saveDraft(target.hostId, sessionId, '')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    scrollToBottom(false)
  }

  function respondPermission(requestId: string, allow: boolean, rememberEntry?: string) {
    socketRef.current?.respondPermission(requestId, allow, rememberEntry)
    if (allow && rememberEntry) {
      setAllowedTools(addAllowedTool(target.hostId, target.projectPath, rememberEntry))
      if (target.session.provider === 'claude') void persistGrantToHost(rememberEntry)
    }
    setPermissions((prev) => prev.filter((p) => p.requestId !== requestId))
  }

  /**
   * Plan review decision. On approval the running query exits plan mode by
   * itself, but the server rebuilds SDK options from our options on every
   * chat.send — so the hub must also drop 'plan' locally or the next message
   * would silently re-enter plan mode.
   */
  function respondPlan(requestId: string, decision: PlanDecision) {
    if (decision === 'revise') {
      socketRef.current?.respondPermission(requestId, false, undefined, 'User asked to revise the plan')
    } else {
      socketRef.current?.respondPermission(requestId, true)
      const nextMode: PermissionMode = decision === 'acceptEdits' ? 'acceptEdits' : 'default'
      setPermissionMode(nextMode)
      savePermissionMode(target.hostId, nextMode)
    }
    setPermissions((prev) => prev.filter((p) => p.requestId !== requestId))
  }

  /**
   * Write-through of an "Always allow" grant into the host project's
   * `.claude/settings.local.json` (`permissions.allow`), so the grant also
   * applies to terminal Claude Code and the host's own UI — the SDK loads
   * settings fresh on every chat.send. Best-effort: the hub's own
   * localStorage grant already covers hub chats if this fails.
   */
  async function persistGrantToHost(entry: string) {
    const token = getToken(target.hostId)
    if (!token) return
    const filePath = '.claude/settings.local.json'
    const onRefresh = (t: string) => saveToken(target.hostId, t)
    let settings: Record<string, unknown> = {}
    try {
      const raw = await readFile(target.baseUrl, token, target.projectId, filePath, onRefresh)
      settings = JSON.parse(raw) as Record<string, unknown>
      if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
        return // unexpected shape — never clobber a file we don't understand
      }
    } catch (err) {
      if (err instanceof SyntaxError) return // corrupt JSON — leave it alone
      // Missing file (or transient read failure) — start from empty settings.
      settings = {}
    }
    const permissions =
      settings.permissions && typeof settings.permissions === 'object'
        ? (settings.permissions as { allow?: unknown })
        : {}
    const allow = Array.isArray(permissions.allow) ? (permissions.allow as string[]) : []
    if (allow.includes(entry)) return
    settings.permissions = { ...permissions, allow: [...allow, entry] }
    try {
      await saveFile(
        target.baseUrl,
        token,
        target.projectId,
        filePath,
        `${JSON.stringify(settings, null, 2)}\n`,
        onRefresh,
      )
    } catch {
      // Likely the .claude/ directory doesn't exist (PUT never creates parents).
      setBanner(
        `Allowed in the hub, but couldn't save to ${filePath} on the host — create the .claude directory there to persist grants.`,
      )
    }
  }

  const color = hostColor(target.hostColorIdx)
  const visible = useMemo(() => messages.filter((m) => RENDERED_KINDS.has(m.kind)), [messages])
  const canChat = target.session.provider !== 'cursor' || !fatalError

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header
        className="flex shrink-0 items-center gap-3 border-b border-ink-800 px-4 py-3"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <button
          type="button"
          onClick={onBack}
          title="Back"
          className="shrink-0 rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-ink-500">
            <span className="inline-flex items-center gap-1 font-medium text-ink-400">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              {target.hostName}
            </span>
            <span>·</span>
            <span className="truncate font-mono">{target.projectName}</span>
          </div>
          <h2 className="font-display truncate text-sm font-semibold text-ink-100">
            {target.session.summary || 'New session'}
          </h2>
        </div>
        <ProviderBadge provider={target.session.provider} />
        <a
          href={target.href}
          target="_blank"
          rel="noreferrer"
          title="Open in this host's own CloudCLI UI"
          className="shrink-0 rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
        >
          <ExternalLink size={15} />
        </a>
      </header>

      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current
          if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
        className="flex-1 overflow-y-auto px-6 py-4"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-ink-500">
            <LoaderCircle size={20} className="animate-spin" />
          </div>
        ) : fatalError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <TriangleAlert size={20} className="text-amber-400" />
            <p className="text-sm text-ink-400">{fatalError}</p>
            {target.session.provider === 'cursor' && (
              <p className="text-xs text-ink-600">
                Cursor sessions created from the Cursor IDE have no readable store — this is a known
                CloudCLI limitation.
              </p>
            )}
          </div>
        ) : (
          <div ref={contentRef} className="mx-auto flex max-w-[54rem] flex-col gap-3">
            {hasMore && (
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="mx-auto inline-flex items-center gap-1 rounded-full border border-ink-800 px-3 py-1 text-xs text-ink-400 transition-colors hover:bg-ink-800 disabled:opacity-50"
              >
                {loadingOlder ? <LoaderCircle size={12} className="animate-spin" /> : <ChevronUp size={12} />}
                Load older messages
              </button>
            )}
            {visible.length === 0 && !processing && (
              <p className="py-16 text-center text-sm text-ink-500">
                No messages yet — send the first one below.
              </p>
            )}
            {visible.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                imageSource={{ baseUrl: target.baseUrl, hostId: target.hostId }}
              />
            ))}
            {permissions.map((request) =>
              isPlanRequest(request) ? (
                <PlanApprovalCard key={request.requestId} request={request} onDecide={respondPlan} />
              ) : (
                <PermissionCard key={request.requestId} request={request} onRespond={respondPermission} />
              ),
            )}
            {processing && permissions.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-ink-500">
                <LoaderCircle size={12} className="animate-spin" /> working…
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-ink-800 px-6 py-3">
        <div className="relative mx-auto max-w-[54rem]">
          {autocomplete.open && (
            <CompletionMenu
              items={autocomplete.items}
              selected={autocomplete.selected}
              onHover={autocomplete.setSelected}
              onPick={autocomplete.pick}
            />
          )}
          {banner && (
            <div className="mb-2 flex items-center gap-2 text-xs text-amber-400">
              <TriangleAlert size={12} /> {banner}
            </div>
          )}
          <div
            className="rounded-xl border border-ink-700 bg-ink-900 p-2 focus-within:border-brass-400/60"
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) event.preventDefault()
            }}
            onDrop={(event) => {
              if (event.dataTransfer.files.length === 0) return
              event.preventDefault()
              attachImages(Array.from(event.dataTransfer.files))
            }}
          >
            {pendingImages.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 px-1">
                {pendingImages.map((chip) => (
                  <div
                    key={chip.id}
                    title={chip.name}
                    className={`group/chip relative h-14 w-14 overflow-hidden rounded-md border ${
                      chip.status === 'error' ? 'border-rose-500/60' : 'border-ink-700'
                    }`}
                  >
                    <img
                      src={chip.previewUrl}
                      alt={chip.name}
                      className={`h-full w-full object-cover ${chip.status === 'ready' ? '' : 'opacity-40'}`}
                    />
                    {chip.status === 'uploading' && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <LoaderCircle size={14} className="animate-spin text-ink-300" />
                      </span>
                    )}
                    {chip.status === 'error' && (
                      <span
                        title="Upload failed"
                        className="absolute inset-0 flex items-center justify-center text-rose-400"
                      >
                        <TriangleAlert size={14} />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(chip.id)}
                      title="Remove"
                      className="absolute right-0.5 top-0.5 rounded-full bg-ink-950/80 p-0.5 text-ink-400 opacity-0 transition-opacity hover:text-ink-100 group-hover/chip:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) attachImages(Array.from(event.target.files))
                event.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canChat || socketState !== 'open' || pendingImages.length >= MAX_IMAGES}
              title="Attach images (or paste / drag & drop)"
              className="shrink-0 rounded-lg p-2 text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-200 disabled:opacity-40"
            >
              <ImagePlus size={16} />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files)
                if (files.length > 0) {
                  event.preventDefault()
                  attachImages(files)
                }
              }}
              onChange={(event) => {
                setInput(event.target.value)
                saveDraft(target.hostId, sessionId, event.target.value)
                autocomplete.update(event.target.value, event.target.selectionStart ?? event.target.value.length)
                const el = event.target
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`
              }}
              onKeyDown={(event) => {
                if (autocomplete.onKeyDown(event.key)) {
                  event.preventDefault()
                  return
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
              onBlur={autocomplete.close}
              rows={1}
              placeholder={
                socketState === 'open'
                  ? `Message ${target.session.provider} in ${target.projectName}…`
                  : 'Connecting to host…'
              }
              disabled={!canChat || socketState !== 'open'}
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-ink-100 outline-none placeholder:text-ink-600 disabled:opacity-50"
            />
            {processing ? (
              <button
                type="button"
                onClick={() => socketRef.current?.abort(sessionId)}
                title="Stop the agent"
                className="shrink-0 rounded-lg bg-rose-600/90 p-2 text-white transition-colors hover:bg-rose-500"
              >
                <CircleStop size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={!input.trim() || socketState !== 'open'}
                title="Send (Enter)"
                className="shrink-0 rounded-lg bg-brass-400 p-2 text-ink-950 transition-colors hover:bg-brass-300 disabled:opacity-40"
              >
                <ArrowUp size={16} />
              </button>
            )}
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-600">
            <select
              value={permissionMode}
              onChange={(event) => {
                const mode = event.target.value as PermissionMode
                setPermissionMode(mode)
                savePermissionMode(target.hostId, mode)
              }}
              title="Permission mode"
              className="rounded border border-ink-800 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-400 outline-none"
            >
              {PERMISSION_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
            {modelOptions.length > 0 && (
              <select
                value={model}
                onChange={(event) => changeModel(event.target.value)}
                title="Model"
                className="max-w-40 rounded border border-ink-800 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-400 outline-none"
              >
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            {activeModel?.effort && activeModel.effort.values.length > 0 && (
              <select
                value={effort || activeModel.effort.default}
                onChange={(event) => changeEffort(event.target.value)}
                title="Reasoning effort"
                className="rounded border border-ink-800 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-400 outline-none"
              >
                {activeModel.effort.values.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}
                  </option>
                ))}
              </select>
            )}
            <span className="ml-auto hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

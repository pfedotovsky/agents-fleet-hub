import { useEffect, useMemo, useRef, useState } from 'react'
import { Folder, LoaderCircle, MessageSquare, Search, X } from 'lucide-react'
import type { FleetSession, HostRuntime, Provider } from '../types'
import { searchSessions } from '../lib/search'
import type { SearchMatch, SearchProgress, SearchProjectResult } from '../lib/search'
import { hostColor } from '../lib/format'
import { getToken, saveToken } from '../lib/storage'
import { ProviderBadge } from './Messages'

const DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

interface HostSearchState {
  status: 'searching' | 'done' | 'error'
  error?: string
  progress?: SearchProgress
  results: SearchProjectResult[]
}

/** One selectable row: a matched session, with enough context to open its chat. */
interface ResultItem {
  key: string
  hostId: string
  hostName: string
  hostColorIdx: number
  baseUrl: string
  project: SearchProjectResult
  sessionId: string
  provider: Provider
  sessionSummary: string
  matches: SearchMatch[]
}

interface Props {
  hosts: HostRuntime[]
  onOpenSession: (target: FleetSession) => void
  onClose: () => void
}

/** Renders a snippet with the host-reported match ranges wrapped in <mark>. */
function HighlightedSnippet({ match }: { match: SearchMatch }) {
  const parts: React.ReactNode[] = []
  let cursor = 0
  const ranges = [...match.highlights].sort((a, b) => a.start - b.start)
  for (const [index, range] of ranges.entries()) {
    const start = Math.max(cursor, range.start)
    const end = Math.min(match.snippet.length, range.end)
    if (start > cursor) parts.push(match.snippet.slice(cursor, start))
    if (end > start) {
      parts.push(
        <mark key={index} className="rounded-sm bg-accent/25 px-px text-accent-strong">
          {match.snippet.slice(start, end)}
        </mark>,
      )
      cursor = end
    }
  }
  if (cursor < match.snippet.length) parts.push(match.snippet.slice(cursor))
  return <span className="line-clamp-2 text-[12px] leading-5 text-fg-faint">{parts}</span>
}

export function SearchOverlay({ hosts, onOpenSession, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [hostStates, setHostStates] = useState<Record<string, HostSearchState>>({})
  const [selected, setSelected] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const onlineHosts = hosts.filter(
    (runtime) => runtime.status === 'online' && getToken(runtime.config.id),
  )
  const skippedCount = hosts.length - onlineHosts.length

  useEffect(() => {
    inputRef.current?.focus()
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    abortRef.current?.abort()
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setHostStates({})
      setSelected(0)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const timer = setTimeout(() => {
      setSelected(0)
      setHostStates(
        Object.fromEntries(
          onlineHosts.map((runtime) => [
            runtime.config.id,
            { status: 'searching', results: [] } satisfies HostSearchState,
          ]),
        ),
      )
      for (const runtime of onlineHosts) {
        const hostId = runtime.config.id
        const token = getToken(hostId)
        if (!token) continue
        const patch = (update: (prev: HostSearchState) => HostSearchState) =>
          setHostStates((prev) =>
            prev[hostId] ? { ...prev, [hostId]: update(prev[hostId]) } : prev,
          )
        searchSessions(runtime.config.baseUrl, token, trimmed, {
          signal: controller.signal,
          onResult: (result, progress) =>
            patch((prev) => ({ ...prev, progress, results: [...prev.results, result] })),
          onProgress: (progress) => patch((prev) => ({ ...prev, progress })),
          onTokenRefresh: (t) => saveToken(hostId, t),
        })
          .then(() => {
            if (!controller.signal.aborted) patch((prev) => ({ ...prev, status: 'done' }))
          })
          .catch((err) => {
            if (!controller.signal.aborted)
              patch((prev) => ({
                ...prev,
                status: 'error',
                error: err instanceof Error ? err.message : 'Search failed',
              }))
          })
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // onlineHosts is derived fresh each render; re-running on hosts churn would restart searches mid-stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const items: ResultItem[] = useMemo(() => {
    const list: ResultItem[] = []
    hosts.forEach((runtime, hostIndex) => {
      const state = hostStates[runtime.config.id]
      if (!state) return
      for (const project of state.results) {
        for (const session of project.sessions) {
          list.push({
            key: `${runtime.config.id}:${session.sessionId}`,
            hostId: runtime.config.id,
            hostName: runtime.config.name,
            hostColorIdx: hostIndex,
            baseUrl: runtime.config.baseUrl,
            project,
            sessionId: session.sessionId,
            provider: session.provider,
            sessionSummary: session.sessionSummary,
            matches: session.matches,
          })
        }
      }
    })
    return list
  }, [hosts, hostStates])

  const anySearching = Object.values(hostStates).some((state) => state.status === 'searching')
  const totalMatches = Object.values(hostStates).reduce(
    (sum, state) => sum + (state.progress?.totalMatches ?? 0),
    0,
  )

  const open = (item: ResultItem) => {
    const runtime = hosts.find((r) => r.config.id === item.hostId)
    const project = runtime?.projects.find(
      (p) => p.projectId === item.project.projectId || p.displayName === item.project.projectDisplayName,
    )
    onOpenSession({
      key: item.key,
      hostId: item.hostId,
      hostName: item.hostName,
      hostColorIdx: item.hostColorIdx,
      baseUrl: item.baseUrl,
      projectName: item.project.projectDisplayName,
      projectPath: project?.fullPath ?? '',
      projectId: project?.projectId ?? item.project.projectId ?? '',
      session: {
        id: item.sessionId,
        provider: item.provider,
        summary: item.sessionSummary,
        messageCount: 0,
        lastActivity: item.matches[0]?.timestamp ?? '',
      },
      href: `${item.baseUrl}/session/${item.sessionId}`,
      stale: runtime?.status !== 'online',
      justUpdated: false,
    })
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((prev) => Math.min(items.length - 1, prev + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((prev) => Math.max(0, prev - 1))
    } else if (event.key === 'Enter' && items[selected]) {
      event.preventDefault()
      open(items[selected])
    }
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // Group consecutive items by host → project purely for headers; the flat
  // index keeps keyboard navigation trivial.
  let lastGroup = ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/70 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Search conversations"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line-strong/80 bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          {anySearching ? (
            <LoaderCircle size={15} className="shrink-0 animate-spin text-fg-faint" />
          ) : (
            <Search size={15} className="shrink-0 text-fg-faint" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations across all hosts…"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
          {query && (
            <span className="tnum shrink-0 font-mono text-[11px] text-fg-subtle">
              {totalMatches} match{totalMatches === 1 ? '' : 'es'}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-elevated hover:text-fg-secondary"
          >
            <X size={14} />
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto p-2">
          {query.trim().length < MIN_QUERY_LENGTH ? (
            <p className="px-3 py-8 text-center text-sm text-fg-subtle">
              Type at least {MIN_QUERY_LENGTH} characters to search
              {skippedCount > 0 && ` · ${skippedCount} offline host${skippedCount === 1 ? '' : 's'} skipped`}
            </p>
          ) : items.length === 0 && !anySearching ? (
            <p className="px-3 py-8 text-center text-sm text-fg-subtle">No matches</p>
          ) : (
            items.map((item, index) => {
              const group = `${item.hostId}:${item.project.projectDisplayName}`
              const showHeader = group !== lastGroup
              lastGroup = group
              return (
                <div key={item.key}>
                  {showHeader && (
                    <div className="mt-2 flex items-center gap-1.5 px-3 pb-1 pt-1 text-[11px] font-medium text-fg-faint first:mt-0">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: hostColor(item.hostColorIdx) }}
                      />
                      {item.hostName}
                      <span className="text-fg-subtle">/</span>
                      <Folder size={10} className="shrink-0" />
                      <span className="truncate font-mono">{item.project.projectDisplayName}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    data-index={index}
                    onClick={() => open(item)}
                    onMouseMove={() => setSelected(index)}
                    className={`flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left ${
                      index === selected ? 'bg-elevated' : 'hover:bg-elevated/50'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <MessageSquare size={11} className="shrink-0 text-fg-subtle" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                        {item.sessionSummary || 'Untitled session'}
                      </span>
                      <ProviderBadge provider={item.provider} />
                    </span>
                    {item.matches.slice(0, 2).map((match, matchIndex) => (
                      <HighlightedSnippet key={matchIndex} match={match} />
                    ))}
                  </button>
                </div>
              )
            })
          )}
          {anySearching && (
            <p className="flex items-center justify-center gap-2 px-3 py-3 text-[12px] text-fg-subtle">
              <LoaderCircle size={11} className="animate-spin" />
              {Object.entries(hostStates)
                .filter(([, state]) => state.status === 'searching' && state.progress)
                .map(([hostId, state]) => {
                  const name = hosts.find((r) => r.config.id === hostId)?.config.name ?? hostId
                  return `${name}: ${state.progress!.scannedProjects}/${state.progress!.totalProjects}`
                })
                .join(' · ') || 'searching…'}
            </p>
          )}
          {Object.entries(hostStates)
            .filter(([, state]) => state.status === 'error')
            .map(([hostId, state]) => (
              <p key={hostId} className="px-3 py-1 text-[12px] text-rose-400">
                {hosts.find((r) => r.config.id === hostId)?.config.name ?? hostId}: {state.error}
              </p>
            ))}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-fg-subtle">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}

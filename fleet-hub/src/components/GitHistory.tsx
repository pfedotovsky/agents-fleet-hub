import { useCallback, useEffect, useState } from 'react'
import { GitCommitHorizontal, GitMerge, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { GitCommitSummary } from '../types'
import { getGitCommitDiff, getGitCommits } from '../lib/api'
import { relativeTime } from '../lib/format'
import { Diff } from './Diff'

interface Props {
  baseUrl: string
  projectId: string
  auth: { token: string; onTokenRefresh: (token: string) => void }
  refreshKey: number
  embedded?: boolean
}

const PAGE_SIZE = 20
const MAX_COMMITS = 100

function HistorySkeleton() {
  return (
    <div className="space-y-1 p-2" aria-label="Loading commit history">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex gap-2 rounded-md px-2 py-2.5">
          <div className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-elevated-strong" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-4/5 animate-pulse rounded bg-elevated" />
            <div className="h-2.5 w-2/5 animate-pulse rounded bg-surface" />
          </div>
        </div>
      ))}
    </div>
  )
}

function refLabel(ref: string): string {
  return ref.replace(/^HEAD -> /, '').replace(/^tag: /, '')
}

export function GitHistory({ baseUrl, projectId, auth, refreshKey, embedded }: Props) {
  const [commits, setCommits] = useState<GitCommitSummary[] | null>(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<GitCommitSummary | null>(null)
  const [diff, setDiff] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [diffTruncated, setDiffTruncated] = useState(false)

  const loadCommits = useCallback(
    async (nextLimit: number, initial: boolean) => {
      if (initial) setCommits(null)
      else setLoadingMore(true)
      setError(null)
      try {
        const next = await getGitCommits(baseUrl, projectId, nextLimit, auth)
        setCommits(next)
        setLimit(nextLimit)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load commit history')
        if (initial) setCommits([])
      } finally {
        setLoadingMore(false)
      }
    },
    [auth, baseUrl, projectId],
  )

  useEffect(() => {
    void loadCommits(PAGE_SIZE, true)
  }, [loadCommits, refreshKey])

  const openCommit = useCallback(
    (commit: GitCommitSummary) => {
      setSelected(commit)
      setDiffLoading(true)
      setDiffError(null)
      getGitCommitDiff(baseUrl, projectId, commit.hash, auth)
        .then((result) => {
          setDiff(result.diff)
          setDiffTruncated(result.isTruncated)
        })
        .catch((err) => {
          setDiff('')
          setDiffError(err instanceof Error ? err.message : 'Failed to load commit diff')
        })
        .finally(() => setDiffLoading(false))
    },
    [auth, baseUrl, projectId],
  )

  const hasMore = commits !== null && commits.length === limit && limit < MAX_COMMITS

  return (
    <div className="flex min-h-0 flex-1">
      <div className={`flex ${embedded ? 'w-64' : 'w-80'} shrink-0 flex-col border-r border-line/80`}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {commits === null ? (
            <HistorySkeleton />
          ) : error && commits.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <TriangleAlert size={18} className="text-danger" />
              <p className="text-xs text-fg-muted">{error}</p>
              <button
                type="button"
                onClick={() => void loadCommits(limit, true)}
                className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary hover:bg-elevated"
              >
                Try again
              </button>
            </div>
          ) : commits.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <GitCommitHorizontal size={19} className="text-fg-subtle" />
              <p className="text-xs text-fg-muted">No commits yet.</p>
              <p className="text-[11px] text-fg-subtle">The first commit will appear here.</p>
            </div>
          ) : (
            <>
              <ol className="py-1">
                {commits.map((commit) => {
                  const isMerge = commit.parents.length > 1
                  const Icon = isMerge ? GitMerge : GitCommitHorizontal
                  const active = selected?.hash === commit.hash
                  return (
                    <li key={commit.hash}>
                      <button
                        type="button"
                        onClick={() => openCommit(commit)}
                        aria-pressed={active}
                        className={`group/commit flex w-full gap-2 px-3 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50 ${
                          active ? 'bg-elevated' : 'hover:bg-surface'
                        }`}
                      >
                        <Icon
                          size={13}
                          className={`mt-0.5 shrink-0 ${active ? 'text-fg-secondary' : 'text-fg-subtle'}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-fg-secondary">
                            {commit.message || 'Untitled commit'}
                          </span>
                          {commit.refs.length > 0 && (
                            <span className="mt-1 flex min-w-0 flex-wrap gap-1">
                              {commit.refs.slice(0, 3).map((ref) => (
                                <span
                                  key={ref}
                                  title={ref}
                                  className="max-w-full truncate rounded bg-elevated-strong/60 px-1 py-0.5 font-mono text-[9px] text-fg-muted"
                                >
                                  {refLabel(ref)}
                                </span>
                              ))}
                            </span>
                          )}
                          <span className="tnum mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-fg-muted">
                            <span className="truncate">{commit.author}</span>
                            <span aria-hidden="true">·</span>
                            <time dateTime={commit.date} title={new Date(commit.date).toLocaleString()}>
                              {relativeTime(commit.date)}
                            </time>
                            <code className="ml-auto shrink-0 font-mono">{commit.hash.slice(0, 7)}</code>
                          </span>
                          {commit.stats && (
                            <span className="mt-0.5 block truncate text-[10px] text-fg-muted">
                              {commit.stats}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
              {error && <p className="px-3 py-2 text-xs text-danger">{error}</p>}
              {hasMore && (
                <div className="border-t border-line/60 p-2">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void loadCommits(Math.min(limit + PAGE_SIZE, MAX_COMMITS), false)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-xs text-fg-muted hover:bg-elevated disabled:opacity-40"
                  >
                    {loadingMore && <LoaderCircle size={12} className="animate-spin" />}
                    Load older commits
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 p-3">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <GitCommitHorizontal size={19} className="text-fg-subtle" />
            <p className="text-sm text-fg-muted">Select a commit to inspect its patch</p>
          </div>
        ) : diffLoading ? (
          <div className="flex h-full items-center justify-center">
            <LoaderCircle size={18} className="animate-spin text-fg-subtle" />
          </div>
        ) : diffError ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-danger">
            <TriangleAlert size={14} /> {diffError}
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="shrink-0">
              <h3 className="truncate text-sm font-medium text-fg" title={selected.message}>
                {selected.message || 'Untitled commit'}
              </h3>
              <p className="mt-0.5 truncate font-mono text-[10px] text-fg-subtle" title={selected.hash}>
                {selected.hash}
              </p>
            </div>
            {diff.trim() === '' ? (
              <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-fg-subtle">
                This commit has no patch to display.
              </div>
            ) : (
              <Diff
                unified={diff}
                badge={diffTruncated ? 'truncated' : undefined}
                badgeColor={diffTruncated ? 'amber' : 'gray'}
                tall
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

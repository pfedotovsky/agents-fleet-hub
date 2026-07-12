import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CloudUpload,
  GitBranch,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { GitBranches, GitRemoteStatus, GitStatus, HostRuntime, Project } from '../types'
import {
  AuthError,
  generateCommitMessage,
  getGitBranches,
  getGitDiff,
  getGitRemoteStatus,
  getGitStatus,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitRemoteAction,
  gitStage,
  gitUnstage,
} from '../lib/api'
import { getToken, saveToken } from '../lib/storage'
import { hostColor } from '../lib/format'
import { Diff } from './Diff'

interface Props {
  runtime: HostRuntime
  hostColorIdx: number
  project: Project
  onBack: () => void
  /** Rendered as a side panel next to a chat: close icon, narrower file list. */
  embedded?: boolean
}

type FileGroup = 'staged' | 'changes' | 'untracked'

interface ChangedFile {
  path: string
  group: FileGroup
  deleted: boolean
}

/** Splits the status lists into display groups; staged wins over "changes". */
function groupFiles(status: GitStatus): ChangedFile[] {
  const staged = new Set(status.staged)
  const deleted = new Set(status.deleted)
  const files: ChangedFile[] = []
  const seen = new Set<string>()
  for (const path of status.staged) {
    files.push({ path, group: 'staged', deleted: deleted.has(path) })
    seen.add(path)
  }
  for (const path of [...status.modified, ...status.added, ...status.deleted]) {
    if (seen.has(path) || staged.has(path)) continue
    seen.add(path)
    files.push({ path, group: 'changes', deleted: deleted.has(path) })
  }
  for (const path of status.untracked) {
    if (seen.has(path)) continue
    seen.add(path)
    files.push({ path, group: 'untracked', deleted: false })
  }
  return files
}

const GROUP_LABELS: Record<FileGroup, string> = {
  staged: 'Staged',
  changes: 'Changes',
  untracked: 'Untracked',
}

export function GitPanel({ runtime, hostColorIdx, project, onBack, embedded }: Props) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [remote, setRemote] = useState<GitRemoteStatus | null>(null)
  const [branches, setBranches] = useState<GitBranches | null>(null)
  const [loading, setLoading] = useState(true)
  const [notRepo, setNotRepo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffText, setDiffText] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)
  /** Which mutation is in flight — one at a time keeps git state sane. */
  const [busy, setBusy] = useState<string | null>(null)
  const [creatingBranch, setCreatingBranch] = useState(false)
  const [newBranch, setNewBranch] = useState('')

  const color = hostColor(hostColorIdx)
  const hostId = runtime.config.id
  const baseUrl = runtime.config.baseUrl

  const auth = useMemo(
    () => ({
      get token() {
        return getToken(hostId) ?? ''
      },
      onTokenRefresh: (t: string) => saveToken(hostId, t),
    }),
    [hostId],
  )

  const refresh = useCallback(
    async (initial = false) => {
      if (initial) setLoading(true)
      setError(null)
      try {
        const [nextStatus, nextRemote, nextBranches] = await Promise.all([
          getGitStatus(baseUrl, project.projectId, auth),
          getGitRemoteStatus(baseUrl, project.projectId, auth).catch(() => null),
          getGitBranches(baseUrl, project.projectId, auth).catch(() => null),
        ])
        setStatus(nextStatus)
        setRemote(nextRemote)
        setBranches(nextBranches)
        setNotRepo(false)
        // Preselect everything already tracked; untracked files are opt-in.
        setChecked((prev) => {
          const files = groupFiles(nextStatus)
          const valid = new Set(files.map((file) => file.path))
          const next = new Set([...prev].filter((path) => valid.has(path)))
          if (initial || prev.size === 0) {
            for (const file of files) if (file.group !== 'untracked') next.add(file.path)
          }
          return next
        })
      } catch (err) {
        if (err instanceof Error && /not a git repository/i.test(err.message)) {
          setNotRepo(true)
        } else if (err instanceof AuthError) {
          setError('The hub token for this host expired — sign in again from the sidebar.')
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load git status')
        }
      } finally {
        setLoading(false)
      }
    },
    [auth, baseUrl, project.projectId],
  )

  useEffect(() => {
    void refresh(true)
  }, [refresh])

  useEffect(() => {
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const openDiff = useCallback(
    (path: string) => {
      setSelectedFile(path)
      setDiffLoading(true)
      setDiffError(null)
      getGitDiff(baseUrl, project.projectId, path, auth)
        .then(setDiffText)
        .catch((err) => setDiffError(err instanceof Error ? err.message : 'Failed to load diff'))
        .finally(() => setDiffLoading(false))
    },
    [auth, baseUrl, project.projectId],
  )

  /** Runs one mutation, then re-syncs status/remote (and the open diff). */
  async function run(label: string, action: () => Promise<string | void>): Promise<boolean> {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      const output = await action()
      if (typeof output === 'string' && output.trim()) setNotice(output.trim())
      await refresh()
      if (selectedFile) openDiff(selectedFile)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`)
      return false
    } finally {
      setBusy(null)
    }
  }

  async function generate() {
    const files = [...checked]
    if (files.length === 0) return
    setGenerating(true)
    setError(null)
    try {
      const generated = await generateCommitMessage(baseUrl, project.projectId, files, auth)
      if (generated) setMessage(generated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate a message')
    } finally {
      setGenerating(false)
    }
  }

  const files = useMemo(() => (status ? groupFiles(status) : []), [status])
  const groups = useMemo(
    () =>
      (['staged', 'changes', 'untracked'] as FileGroup[])
        .map((group) => ({ group, files: files.filter((file) => file.group === group) }))
        .filter(({ files: groupFiles }) => groupFiles.length > 0),
    [files],
  )
  const checkedFiles = useMemo(() => files.filter((file) => checked.has(file.path)), [files, checked])
  const canCommit = checkedFiles.length > 0 && message.trim().length > 0 && !busy

  const toggleChecked = (path: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const header = (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-ink-800 px-4 py-3"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <button
        type="button"
        onClick={onBack}
        title={embedded ? 'Close panel' : 'Back to project'}
        className="shrink-0 rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
      >
        {embedded ? <X size={16} /> : <ArrowLeft size={16} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] text-ink-500">
          <span className="inline-flex items-center gap-1 font-medium text-ink-400">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            {runtime.config.name}
          </span>
          <span>·</span>
          <span className="truncate font-mono">Git</span>
        </div>
        <h2 className="font-display truncate text-sm font-semibold text-ink-100">
          {project.displayName}
        </h2>
      </div>
      <button
        type="button"
        onClick={() => void refresh()}
        title="Refresh"
        className="shrink-0 rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
      >
        <RefreshCw size={14} />
      </button>
    </header>
  )

  if (loading) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {header}
        <div className="flex flex-1 items-center justify-center text-ink-500">
          <LoaderCircle size={20} className="animate-spin" />
        </div>
      </div>
    )
  }

  if (notRepo) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <GitBranch size={22} className="text-ink-700" />
          <p className="text-sm text-ink-400">This project is not a git repository.</p>
          <p className="text-xs text-ink-600">
            Run <code className="rounded bg-ink-900 px-1">git init</code> on the host to start
            tracking it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {header}
      <div className="flex min-h-0 flex-1">
        {/* Left pane: branch, remote, changed files, commit box */}
        <div className={`flex ${embedded ? 'w-64' : 'w-80'} shrink-0 flex-col border-r border-ink-800/80`}>
          <div className="flex flex-col gap-2 border-b border-ink-800/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <GitBranch size={13} className="shrink-0 text-ink-500" />
              {branches?.localBranches.length ? (
                <select
                  value={status?.branch ?? ''}
                  disabled={!!busy}
                  onChange={(event) => {
                    const branch = event.target.value
                    if (branch && branch !== status?.branch)
                      void run('checkout', () =>
                        gitCheckout(baseUrl, project.projectId, branch, auth),
                      )
                  }}
                  title="Switch branch"
                  className="min-w-0 flex-1 rounded border border-ink-800 bg-ink-900 px-1.5 py-1 font-mono text-xs text-ink-300 outline-none"
                >
                  {[...new Set([status?.branch ?? '', ...branches.localBranches])]
                    .filter(Boolean)
                    .map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                </select>
              ) : (
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-300">
                  {status?.branch}
                </span>
              )}
              <button
                type="button"
                onClick={() => setCreatingBranch((prev) => !prev)}
                title="New branch"
                className="shrink-0 rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
              >
                <Plus size={12} />
              </button>
            </div>
            {creatingBranch && (
              <form
                className="flex items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  const branch = newBranch.trim()
                  if (!branch) return
                  void run('create-branch', () =>
                    gitCreateBranch(baseUrl, project.projectId, branch, auth),
                  ).then((ok) => {
                    if (!ok) return
                    setCreatingBranch(false)
                    setNewBranch('')
                  })
                }}
              >
                <input
                  value={newBranch}
                  onChange={(event) => setNewBranch(event.target.value)}
                  placeholder="new-branch-name"
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-ink-800 bg-ink-950 px-1.5 py-1 font-mono text-xs text-ink-200 outline-none focus:border-brass-400/60"
                />
                <button
                  type="submit"
                  disabled={!newBranch.trim() || !!busy}
                  className="shrink-0 rounded bg-brass-400 px-2 py-1 text-[11px] font-medium text-ink-950 hover:bg-brass-300 disabled:opacity-40"
                >
                  Create
                </button>
              </form>
            )}
            {remote?.hasRemote && (
              <div className="flex items-center gap-1.5 text-[11px] text-ink-500">
                {remote.hasUpstream ? (
                  <span
                    className="tnum inline-flex items-center gap-0.5 font-mono"
                    title={`${remote.ahead} ahead, ${remote.behind} behind ${remote.remoteName}`}
                  >
                    <ArrowUp size={11} className={remote.ahead > 0 ? 'text-emerald-400' : ''} />
                    {remote.ahead}
                    <ArrowDown size={11} className={remote.behind > 0 ? 'text-amber-400' : ''} />
                    {remote.behind}
                  </span>
                ) : (
                  <span className="text-ink-600">no upstream</span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  {(['fetch', 'pull'] as const).map((action) => (
                    <button
                      key={action}
                      type="button"
                      disabled={!!busy}
                      onClick={() =>
                        void run(action, () =>
                          gitRemoteAction(baseUrl, project.projectId, action, auth),
                        )
                      }
                      className="rounded border border-ink-800 px-1.5 py-0.5 text-[11px] text-ink-400 hover:bg-ink-800 disabled:opacity-40"
                    >
                      {busy === action ? <LoaderCircle size={10} className="animate-spin" /> : action}
                    </button>
                  ))}
                  {remote.hasUpstream ? (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() =>
                        void run('push', () =>
                          gitRemoteAction(baseUrl, project.projectId, 'push', auth),
                        )
                      }
                      className="rounded border border-ink-800 px-1.5 py-0.5 text-[11px] text-ink-400 hover:bg-ink-800 disabled:opacity-40"
                    >
                      {busy === 'push' ? <LoaderCircle size={10} className="animate-spin" /> : 'push'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!!busy}
                      title="Push and set upstream"
                      onClick={() =>
                        void run('publish', () =>
                          gitRemoteAction(baseUrl, project.projectId, 'publish', auth, status?.branch),
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-ink-800 px-1.5 py-0.5 text-[11px] text-ink-400 hover:bg-ink-800 disabled:opacity-40"
                    >
                      {busy === 'publish' ? (
                        <LoaderCircle size={10} className="animate-spin" />
                      ) : (
                        <CloudUpload size={10} />
                      )}
                      publish
                    </button>
                  )}
                </span>
              </div>
            )}
          </div>

          {(error || notice) && (
            <div
              className={`flex items-start gap-1.5 border-b border-ink-800/60 px-3 py-1.5 text-[11px] ${
                error ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {error ? (
                <TriangleAlert size={11} className="mt-0.5 shrink-0" />
              ) : (
                <Check size={11} className="mt-0.5 shrink-0" />
              )}
              <span className="min-w-0 whitespace-pre-wrap break-words">{error ?? notice}</span>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {files.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-ink-600">
                Working tree clean — nothing to commit.
              </p>
            )}
            {groups.map(({ group, files: groupedFiles }) => (
              <div key={group} className="mb-1">
                <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-600">
                  {GROUP_LABELS[group]} · {groupedFiles.length}
                </div>
                {groupedFiles.map((file) => (
                  <div
                    key={`${group}:${file.path}`}
                    className={`group/file flex items-center gap-1.5 px-2 py-1 ${
                      selectedFile === file.path ? 'bg-ink-800' : 'hover:bg-ink-900'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(file.path)}
                      onChange={() => toggleChecked(file.path)}
                      title="Include in commit"
                      className="shrink-0 accent-brass-400"
                    />
                    <button
                      type="button"
                      onClick={() => openDiff(file.path)}
                      title={file.path}
                      className={`min-w-0 flex-1 truncate text-left font-mono text-xs ${
                        file.deleted ? 'text-rose-400/80 line-through' : 'text-ink-300'
                      }`}
                    >
                      {file.path}
                    </button>
                    {group === 'staged' ? (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() =>
                          void run('unstage', () =>
                            gitUnstage(baseUrl, project.projectId, [file.path], auth),
                          )
                        }
                        title="Unstage"
                        className="shrink-0 rounded p-0.5 text-ink-600 opacity-0 hover:bg-ink-700 hover:text-ink-200 group-hover/file:opacity-100"
                      >
                        <Minus size={11} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() =>
                          void run('stage', () =>
                            gitStage(baseUrl, project.projectId, [file.path], auth),
                          )
                        }
                        title="Stage"
                        className="shrink-0 rounded p-0.5 text-ink-600 opacity-0 hover:bg-ink-700 hover:text-ink-200 group-hover/file:opacity-100"
                      >
                        <Plus size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="border-t border-ink-800/60 p-2.5">
            <div className="relative">
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={`Commit message (${checkedFiles.length} file${checkedFiles.length === 1 ? '' : 's'} selected)…`}
                rows={3}
                className="w-full resize-none rounded-md border border-ink-800 bg-ink-950 px-2 py-1.5 pr-8 text-xs text-ink-200 outline-none placeholder:text-ink-600 focus:border-brass-400/60"
              />
              <button
                type="button"
                onClick={() => void generate()}
                disabled={generating || checkedFiles.length === 0}
                title="Generate a commit message with AI"
                className="absolute right-1.5 top-1.5 rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-brass-300 disabled:opacity-40"
              >
                {generating ? (
                  <LoaderCircle size={13} className="animate-spin" />
                ) : (
                  <Sparkles size={13} />
                )}
              </button>
            </div>
            <button
              type="button"
              disabled={!canCommit}
              onClick={() =>
                void run('commit', () =>
                  gitCommit(
                    baseUrl,
                    project.projectId,
                    message.trim(),
                    checkedFiles.map((file) => file.path),
                    auth,
                  ),
                ).then((ok) => {
                  if (ok) setMessage('')
                })
              }
              className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brass-400 px-3 py-1.5 text-xs font-medium text-ink-950 transition-colors hover:bg-brass-300 disabled:opacity-40"
            >
              {busy === 'commit' ? (
                <LoaderCircle size={13} className="animate-spin" />
              ) : (
                <Check size={13} />
              )}
              Commit {checkedFiles.length > 0 && `(${checkedFiles.length})`}
            </button>
          </div>
        </div>

        {/* Right pane: diff of the selected file */}
        <div className="min-w-0 flex-1 p-3">
          {!selectedFile ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-600">
              Select a file to view its diff
            </div>
          ) : diffLoading ? (
            <div className="flex h-full items-center justify-center">
              <LoaderCircle size={18} className="animate-spin text-ink-600" />
            </div>
          ) : diffError ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-rose-400">
              <TriangleAlert size={14} /> {diffError}
            </div>
          ) : diffText.trim() === '' ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-600">
              No changes in this file.
            </div>
          ) : (
            <Diff unified={diffText} filePath={selectedFile} tall />
          )}
        </div>
      </div>
    </div>
  )
}

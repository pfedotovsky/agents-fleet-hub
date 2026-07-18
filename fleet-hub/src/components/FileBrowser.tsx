import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { ArrowLeft, LoaderCircle, RefreshCw, Save, TriangleAlert, X } from 'lucide-react'
import type { FileNode, HostRuntime, Project } from '../types'
import { AuthError, getFileTree, readFile, saveFile } from '../lib/api'
import { getToken, saveToken } from '../lib/storage'
import { hostColor } from '../lib/format'
import { FileTree } from './FileTree'

const CodeEditor = lazy(() => import('./CodeEditor'))

interface Props {
  runtime: HostRuntime
  hostColorIdx: number
  project: Project
  onBack: () => void
  /** Rendered as a side panel next to a chat: close icon, narrower tree. */
  embedded?: boolean
}

export function FileBrowser({ runtime, hostColorIdx, project, onBack, embedded }: Props) {
  const [tree, setTree] = useState<FileNode[]>([])
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)

  const [selected, setSelected] = useState<FileNode | null>(null)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const color = hostColor(hostColorIdx)
  const dirty = content !== original

  const withToken = useCallback(
    <T,>(fn: (token: string) => Promise<T>): Promise<T> => {
      const token = getToken(runtime.config.id)
      if (!token) return Promise.reject(new AuthError('Not signed in to this host'))
      return fn(token)
    },
    [runtime.config.id],
  )

  const loadTree = useCallback(() => {
    setTreeLoading(true)
    setTreeError(null)
    withToken((token) =>
      getFileTree(runtime.config.baseUrl, token, project.projectId, (t) => saveToken(runtime.config.id, t)),
    )
      .then((nodes) => setTree(nodes))
      .catch((err) =>
        setTreeError(err instanceof Error ? err.message : 'Failed to load the file tree'),
      )
      .finally(() => setTreeLoading(false))
  }, [project.projectId, runtime.config.baseUrl, runtime.config.id, withToken])

  useEffect(loadTree, [loadTree])

  function openFile(node: FileNode) {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    setSelected(node)
    setFileLoading(true)
    setFileError(null)
    setSavedAt(null)
    withToken((token) =>
      readFile(runtime.config.baseUrl, token, project.projectId, node.path, (t) =>
        saveToken(runtime.config.id, t),
      ),
    )
      .then((text) => {
        setContent(text)
        setOriginal(text)
      })
      .catch((err) => setFileError(err instanceof Error ? err.message : 'Failed to read the file'))
      .finally(() => setFileLoading(false))
  }

  async function save() {
    if (!selected || !dirty) return
    setSaving(true)
    setFileError(null)
    try {
      await withToken((token) =>
        saveFile(runtime.config.baseUrl, token, project.projectId, selected.path, content, (t) =>
          saveToken(runtime.config.id, t),
        ),
      )
      setOriginal(content)
      setSavedAt(Date.now())
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Failed to save the file')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          title={embedded ? 'Close panel' : 'Back to project'}
          className="shrink-0 rounded-md p-1.5 text-fg-faint hover:bg-elevated hover:text-fg"
        >
          {embedded ? <X size={16} /> : <ArrowLeft size={16} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-fg-faint">
            <span className="inline-flex items-center gap-1 font-medium text-fg-muted">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              {runtime.config.name}
            </span>
            <span>·</span>
            <span className="truncate font-mono">Files</span>
          </div>
          <h2 className="font-display truncate text-sm font-semibold text-fg">{project.displayName}</h2>
        </div>
        {selected && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-40"
          >
            {saving ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />}
            {savedAt && !dirty ? 'Saved' : 'Save'}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className={`flex ${embedded ? 'w-52' : 'w-64'} shrink-0 flex-col border-r border-line/80`}>
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-fg-faint">
              Explorer
            </span>
            <button
              type="button"
              onClick={loadTree}
              title="Refresh"
              className="rounded p-1 text-fg-faint hover:bg-elevated hover:text-fg"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
            {treeLoading ? (
              <div className="flex justify-center py-8">
                <LoaderCircle size={16} className="animate-spin text-fg-subtle" />
              </div>
            ) : treeError ? (
              <p className="px-2 py-4 text-xs text-rose-400">{treeError}</p>
            ) : (
              <FileTree nodes={tree} selectedPath={selected?.path ?? null} onSelect={openFile} />
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-fg-subtle">
              Select a file to view or edit
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-line/60 px-4 py-1.5 font-mono text-[11px] text-fg-faint">
                <span className="truncate">{selected.path}</span>
                {dirty && <span className="shrink-0 text-amber-400">● unsaved</span>}
              </div>
              {fileError && (
                <div className="flex items-center gap-2 border-b border-line/60 bg-rose-500/5 px-4 py-1.5 text-xs text-rose-400">
                  <TriangleAlert size={12} /> {fileError}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-hidden">
                {fileLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <LoaderCircle size={18} className="animate-spin text-fg-subtle" />
                  </div>
                ) : (
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center">
                        <LoaderCircle size={18} className="animate-spin text-fg-subtle" />
                      </div>
                    }
                  >
                    <CodeEditor filePath={selected.path} value={content} onChange={setContent} />
                  </Suspense>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

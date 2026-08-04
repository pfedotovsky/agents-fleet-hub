import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  CircleCheck,
  LoaderCircle,
  RefreshCw,
  Save,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react'
import type { FileNode, HostRuntime, Project } from '../types'
import { AuthError, getFileTree, readFile, saveFile, uploadProjectFiles } from '../lib/api'
import { getToken, saveToken } from '../lib/storage'
import { hostColor } from '../lib/format'
import { FileTree } from './FileTree'

const CodeEditor = lazy(() => import('./CodeEditor'))
const MAX_UPLOAD_FILES = 20
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

interface UploadIntent {
  files: File[]
  folder: FileNode | null
  conflicts: string[]
}

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
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const [pendingUpload, setPendingUpload] = useState<UploadIntent | null>(null)
  const [uploading, setUploading] = useState<UploadIntent | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [rootDropActive, setRootDropActive] = useState(false)

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

  useEffect(() => () => uploadAbortRef.current?.abort(), [])

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

  function folderChildren(folder: FileNode | null): FileNode[] {
    return folder?.children ?? tree
  }

  function uploadTargetLabel(folder: FileNode | null): string {
    return folder ? folder.name : 'project root'
  }

  function uploadReplacesSelected(intent: UploadIntent): boolean {
    if (!selected) return false
    const targetPath = (intent.folder?.path ?? project.fullPath)
      .replaceAll('\\', '/')
      .replace(/\/+$/, '')
    const selectedPath = selected.path.replaceAll('\\', '/')
    return intent.files.some((file) => selectedPath === `${targetPath}/${file.name}`)
  }

  function prepareUpload(files: File[], folder: FileNode | null) {
    if (uploading || files.length === 0) return
    setUploadError(null)
    setUploadSuccess(null)
    if (files.length > MAX_UPLOAD_FILES) {
      setUploadError(`Choose at most ${MAX_UPLOAD_FILES} files per upload`)
      return
    }
    const tooLarge = files.find((file) => file.size > MAX_UPLOAD_BYTES)
    if (tooLarge) {
      setUploadError(`${tooLarge.name} is larger than 200 MB`)
      return
    }
    const names = files.map((file) => file.name)
    if (new Set(names).size !== names.length) {
      setUploadError('Choose files with unique names for one destination folder')
      return
    }
    const existingNames = new Set(folderChildren(folder).map((node) => node.name))
    const conflicts = names.filter((name) => existingNames.has(name))
    const intent = { files, folder, conflicts }
    if (conflicts.length > 0) {
      setPendingUpload(intent)
      return
    }
    void startUpload(intent, false)
  }

  async function startUpload(intent: UploadIntent, overwrite: boolean) {
    setPendingUpload(null)
    setUploading(intent)
    setUploadProgress(0)
    setUploadError(null)
    setUploadSuccess(null)
    const controller = new AbortController()
    uploadAbortRef.current = controller
    try {
      const result = await withToken((token) =>
        uploadProjectFiles(runtime.config.baseUrl, token, project.projectId, {
          files: intent.files,
          targetPath: intent.folder?.path ?? '',
          overwrite,
          onProgress: setUploadProgress,
          onTokenRefresh: (nextToken) => saveToken(runtime.config.id, nextToken),
          signal: controller.signal,
        }),
      )
      const target = uploadTargetLabel(intent.folder)
      setUploadSuccess(
        `${result.uploadedCount} ${result.uploadedCount === 1 ? 'file' : 'files'} uploaded to ${target}`,
      )

      if (uploadReplacesSelected(intent)) {
        setSelected(null)
        setContent('')
        setOriginal('')
      }
      loadTree()
    } catch (error) {
      setUploadError(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'File upload cancelled'
          : error instanceof Error
            ? error.message
            : 'Failed to upload files',
      )
    } finally {
      uploadAbortRef.current = null
      setUploading(null)
      setUploadProgress(0)
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
            <div className="flex items-center gap-0.5">
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  prepareUpload(Array.from(event.target.files ?? []), null)
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                disabled={Boolean(uploading)}
                title="Upload files to project root"
                aria-label="Upload files to project root"
                className="rounded p-1 text-fg-faint hover:bg-elevated hover:text-fg disabled:opacity-40"
              >
                <Upload size={12} />
              </button>
              <button
                type="button"
                onClick={loadTree}
                title="Refresh"
                aria-label="Refresh file tree"
                className="rounded p-1 text-fg-faint hover:bg-elevated hover:text-fg"
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>
          {pendingUpload && (
            <div role="alert" className="border-y border-warning/30 bg-warning/5 px-2.5 py-2">
              <p className="text-xs font-medium text-fg">
                {pendingUpload.conflicts.length === 1
                  ? `${pendingUpload.conflicts[0]} already exists`
                  : `${pendingUpload.conflicts.length} files already exist`}
              </p>
              <p className="mt-0.5 text-[11px] text-fg-muted">
                Replace in {uploadTargetLabel(pendingUpload.folder)}?
                {dirty && uploadReplacesSelected(pendingUpload)
                  ? ' Unsaved editor changes will be discarded.'
                  : ''}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void startUpload(pendingUpload, true)}
                  className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-on-accent hover:bg-accent-strong"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => setPendingUpload(null)}
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted hover:bg-elevated hover:text-fg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {uploading && (
            <div role="status" aria-live="polite" className="border-y border-line px-2.5 py-2">
              <div className="flex items-center justify-between gap-2 text-[11px] text-fg-muted">
                <span className="min-w-0 truncate">
                  Uploading {uploading.files.length} to {uploadTargetLabel(uploading.folder)}
                </span>
                <button
                  type="button"
                  onClick={() => uploadAbortRef.current?.abort()}
                  className="shrink-0 font-medium text-fg-muted hover:text-fg"
                >
                  Cancel
                </button>
              </div>
              <div
                role="progressbar"
                aria-label="File upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadProgress}
                className="mt-1.5 h-1 overflow-hidden rounded-full bg-elevated"
              >
                <div
                  className="h-full rounded-full bg-info transition-[width] duration-150 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
          {uploadError && !uploading && (
            <div role="alert" className="flex items-start gap-1.5 border-y border-danger/30 bg-danger/5 px-2.5 py-2 text-[11px] text-danger">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                aria-label="Dismiss upload error"
                className="ml-auto shrink-0 rounded p-0.5 hover:bg-danger/10"
              >
                <X size={11} />
              </button>
            </div>
          )}
          {uploadSuccess && !uploading && !uploadError && (
            <div role="status" className="flex items-start gap-1.5 border-y border-success/30 bg-success/5 px-2.5 py-2 text-[11px] text-success">
              <CircleCheck size={12} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{uploadSuccess}</span>
              <button
                type="button"
                onClick={() => setUploadSuccess(null)}
                aria-label="Dismiss upload confirmation"
                className="ml-auto shrink-0 rounded p-0.5 hover:bg-success/10"
              >
                <X size={11} />
              </button>
            </div>
          )}
          <div
            className={`relative min-h-0 flex-1 overflow-y-auto px-1 pb-4 transition-colors ${
              rootDropActive ? 'bg-info/5 ring-1 ring-inset ring-info/40' : ''
            }`}
            onDragEnter={(event) => {
              if (!uploading && event.dataTransfer.types.includes('Files')) setRootDropActive(true)
            }}
            onDragOver={(event) => {
              if (uploading || !event.dataTransfer.types.includes('Files')) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setRootDropActive(false)
              }
            }}
            onDrop={(event) => {
              if (uploading) return
              event.preventDefault()
              setRootDropActive(false)
              prepareUpload(Array.from(event.dataTransfer.files), null)
            }}
          >
            {rootDropActive && (
              <p className="sticky top-0 z-10 mx-1 mt-1 rounded bg-info/10 px-2 py-1 text-center text-[11px] font-medium text-info">
                Drop into project root, or onto a folder
              </p>
            )}
            {treeLoading ? (
              <div className="flex justify-center py-8">
                <LoaderCircle size={16} className="animate-spin text-fg-subtle" />
              </div>
            ) : treeError ? (
              <p className="px-2 py-4 text-xs text-rose-400">{treeError}</p>
            ) : (
              <FileTree
                nodes={tree}
                selectedPath={selected?.path ?? null}
                onSelect={openFile}
                onFilesDrop={(folder, files) => {
                  setRootDropActive(false)
                  prepareUpload(files, folder)
                }}
                uploadDisabled={Boolean(uploading)}
              />
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

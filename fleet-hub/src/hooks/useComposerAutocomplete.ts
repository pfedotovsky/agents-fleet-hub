import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileNode, FleetSession } from '../types'
import { getFileTree, getSkills, getSlashCommands } from '../lib/api'
import { getToken, saveToken } from '../lib/storage'

export interface CompletionItem {
  /** Replaces the whole `@…`/`/…` token, trailing space included. */
  insert: string
  label: string
  detail?: string
  kind: 'file' | 'skill' | 'command'
}

interface Trigger {
  char: '@' | '/' | '$'
  /** Index of the trigger character in the input. */
  start: number
  /** Caret position when the trigger was detected (end of the query). */
  end: number
  query: string
}

const MAX_ITEMS = 10

/**
 * A completable token is `@query` anywhere after whitespace/start, or a
 * `/query` (claude) / `$query` (codex skills) command at the very start of
 * the message — commands only mean anything there. The query runs up to the
 * caret and cannot contain whitespace.
 */
function detectTrigger(value: string, caret: number): Trigger | null {
  const match = /(?:^|\s)([@/$])(\S*)$/.exec(value.slice(0, caret))
  if (!match) return null
  const char = match[1] as '@' | '/' | '$'
  const start = caret - match[2].length - 1
  if (char !== '@' && start !== 0) return null
  return { char, start, end: caret, query: match[2] }
}

function flattenFiles(nodes: FileNode[], projectPath: string): string[] {
  const prefix = projectPath.endsWith('/') ? projectPath : `${projectPath}/`
  const paths: string[] = []
  const walk = (list: FileNode[]) => {
    for (const node of list) {
      if (node.type === 'file') {
        paths.push(node.path.startsWith(prefix) ? node.path.slice(prefix.length) : node.path)
      } else if (node.children) {
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return paths
}

function filterFiles(paths: string[], query: string): CompletionItem[] {
  const q = query.toLowerCase()
  const ranked = paths
    .map((path) => {
      const lower = path.toLowerCase()
      const name = lower.slice(lower.lastIndexOf('/') + 1)
      const rank = !q ? 2 : name.startsWith(q) ? 0 : name.includes(q) ? 1 : lower.includes(q) ? 2 : -1
      return { path, rank }
    })
    .filter((entry) => entry.rank >= 0)
  ranked.sort((a, b) => a.rank - b.rank || a.path.length - b.path.length || a.path.localeCompare(b.path))
  return ranked.slice(0, MAX_ITEMS).map(({ path }) => ({
    insert: `@${path} `,
    label: path,
    kind: 'file' as const,
  }))
}

function filterSlash(items: CompletionItem[], trigger: string, query: string): CompletionItem[] {
  const q = query.toLowerCase()
  const withPrefix = items.filter((item) => item.label.startsWith(trigger))
  if (!q) return withPrefix.slice(0, MAX_ITEMS)
  const byName = withPrefix.filter((item) => item.label.toLowerCase().startsWith(`${trigger}${q}`))
  const pool =
    byName.length > 0
      ? byName
      : withPrefix.filter(
          (item) =>
            item.label.toLowerCase().includes(q) || item.detail?.toLowerCase().includes(q),
        )
  return pool.slice(0, MAX_ITEMS)
}

/**
 * `@`-file and `/`-command completion for the chat composer. Both catalogs are
 * fetched lazily on first trigger and cached until the session target changes.
 */
export function useComposerAutocomplete(
  target: FleetSession,
  applyInput: (next: string, caret: number) => void,
) {
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [items, setItems] = useState<CompletionItem[]>([])
  const [selected, setSelected] = useState(0)

  const slashCache = useRef<Promise<CompletionItem[]> | null>(null)
  const fileCache = useRef<Promise<string[]> | null>(null)
  const inputRef = useRef('')
  const updateSeq = useRef(0)

  useEffect(() => {
    slashCache.current = null
    fileCache.current = null
    setTrigger(null)
    setItems([])
  }, [target.key])

  const loadSlash = useCallback(() => {
    if (!slashCache.current) {
      const token = getToken(target.hostId)
      if (!token) return Promise.resolve([])
      const onRefresh = (t: string) => saveToken(target.hostId, t)
      slashCache.current = Promise.all([
        getSkills(target.baseUrl, token, target.session.provider, target.projectPath, onRefresh).catch(
          () => [],
        ),
        // .claude/commands only exist for claude; other providers keep skills only.
        target.session.provider === 'claude'
          ? getSlashCommands(target.baseUrl, token, target.projectPath, onRefresh).catch(() => [])
          : Promise.resolve([]),
      ]).then(([skills, commands]) => {
        const seen = new Set<string>()
        return [...skills, ...commands]
          .filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)))
          .map((c) => ({
            insert: `${c.name} `,
            label: c.name,
            detail: c.description,
            kind: c.kind,
          }))
      })
    }
    return slashCache.current
  }, [target.baseUrl, target.hostId, target.projectPath, target.session.provider])

  const loadFiles = useCallback(() => {
    if (!fileCache.current) {
      const token = getToken(target.hostId)
      if (!token) return Promise.resolve([])
      fileCache.current = getFileTree(target.baseUrl, token, target.projectId, (t) =>
        saveToken(target.hostId, t),
      )
        .then((nodes) => flattenFiles(nodes, target.projectPath))
        .catch(() => [])
    }
    return fileCache.current
  }, [target.baseUrl, target.hostId, target.projectId, target.projectPath])

  const close = useCallback(() => {
    updateSeq.current += 1
    setTrigger(null)
    setItems([])
  }, [])

  /** Call on every input change with the current value and caret position. */
  const update = useCallback(
    (value: string, caret: number) => {
      inputRef.current = value
      const next = detectTrigger(value, caret)
      const seq = ++updateSeq.current
      setTrigger(next)
      if (!next) {
        setItems([])
        return
      }
      const load = next.char === '@' ? loadFiles() : loadSlash()
      void load.then((all) => {
        if (updateSeq.current !== seq) return
        setItems(
          next.char === '@'
            ? filterFiles(all as string[], next.query)
            : filterSlash(all as CompletionItem[], next.char, next.query),
        )
        setSelected(0)
      })
    },
    [loadFiles, loadSlash],
  )

  const pick = useCallback(
    (item: CompletionItem) => {
      if (!trigger) return
      const value = inputRef.current
      const before = value.slice(0, trigger.start)
      const next = `${before}${item.insert}${value.slice(trigger.end)}`
      close()
      applyInput(next, before.length + item.insert.length)
    },
    [applyInput, close, trigger],
  )

  /** Returns true when the key was consumed by the dropdown (caller must preventDefault). */
  const onKeyDown = useCallback(
    (key: string): boolean => {
      if (!trigger || items.length === 0) return false
      switch (key) {
        case 'ArrowDown':
          setSelected((i) => (i + 1) % items.length)
          return true
        case 'ArrowUp':
          setSelected((i) => (i - 1 + items.length) % items.length)
          return true
        case 'Enter':
        case 'Tab':
          pick(items[selected])
          return true
        case 'Escape':
          close()
          return true
        default:
          return false
      }
    },
    [close, items, pick, selected, trigger],
  )

  return {
    open: trigger !== null && items.length > 0,
    items,
    selected,
    setSelected,
    pick,
    update,
    close,
    onKeyDown,
  }
}

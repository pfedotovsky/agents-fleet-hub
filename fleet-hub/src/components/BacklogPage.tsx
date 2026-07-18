import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Markdown } from './Markdown'

type Load =
  | { status: 'loading' }
  | { status: 'ready'; md: string }
  | { status: 'error'; message: string }

/**
 * Full-page developer view of docs/backlog.md, opened in its own browser tab
 * (see the onOpenBacklog handler in App.tsx). Renders the backlog via the shared
 * <Markdown> component and offers a quick-add box that appends items to the
 * Inbox section on disk through the dev-only Vite middleware (`/__backlog`).
 * Reached only under import.meta.env.DEV — nothing here ships in a release build.
 */
export function BacklogPage() {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function fetchBacklog() {
    try {
      const res = await fetch('/__backlog')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setLoad({ status: 'ready', md: await res.text() })
    } catch (err) {
      setLoad({ status: 'error', message: String(err) })
    }
  }

  useEffect(() => {
    void fetchBacklog()
    document.title = 'Backlog · Agents Hub'
  }, [])

  async function onAdd(event: FormEvent) {
    event.preventDefault()
    const item = draft.trim()
    if (!item || adding) return
    setAdding(true)
    try {
      const res = await fetch('/__backlog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDraft('')
      await fetchBacklog()
      inputRef.current?.focus()
    } catch (err) {
      setLoad({ status: 'error', message: `Add failed: ${String(err)}` })
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-semibold">Backlog</h1>
            <p className="truncate font-mono text-[11px] text-fg-faint">docs/backlog.md · dev only</p>
          </div>
          <form onSubmit={onAdd} className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Quick-add to Inbox…"
              className="w-64 max-w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:border-line-strong focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim() || adding}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-elevated-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={14} />
              Add
            </button>
            <button
              type="button"
              onClick={() => void fetchBacklog()}
              title="Reload"
              className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-elevated hover:text-fg"
            >
              <RefreshCw size={14} />
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        {load.status === 'loading' && <p className="text-sm text-fg-faint">Loading backlog…</p>}
        {load.status === 'error' && <p className="text-sm text-rose-400">{load.message}</p>}
        {load.status === 'ready' && <Markdown>{load.md}</Markdown>}
      </main>
    </div>
  )
}

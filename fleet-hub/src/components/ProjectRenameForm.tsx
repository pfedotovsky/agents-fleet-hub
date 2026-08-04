import { useState, type FormEvent } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'

interface Props {
  displayName: string
  onRename: (displayName: string) => Promise<void>
  onCancel: () => void
  className?: string
}

export function ProjectRenameForm({ displayName, onRename, onCancel, className = '' }: Props) {
  const [value, setValue] = useState(displayName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = value.trim()

  async function save() {
    if (saving) return
    if (trimmed === displayName.trim()) {
      onCancel()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onRename(trimmed)
      onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        event.stopPropagation()
        void save()
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      className={`flex min-w-0 items-center gap-1 ${className}`}
    >
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={500}
        aria-label="Project name"
        aria-invalid={Boolean(error)}
        title={error ?? 'Leave blank to reset to the host default name'}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            void save()
          }
        }}
        className={`min-w-0 flex-1 rounded border bg-canvas px-1.5 py-0.5 text-sm text-fg outline-none focus:border-accent/70 ${
          error ? 'border-rose-500/70' : 'border-line-strong'
        }`}
      />
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}
      <button
        type="submit"
        disabled={saving}
        title="Save name (Enter)"
        aria-label="Save project name"
        className="shrink-0 rounded p-1 text-fg-faint hover:bg-elevated-strong hover:text-fg disabled:opacity-40"
      >
        {saving ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        title="Cancel (Escape)"
        aria-label="Cancel project rename"
        className="shrink-0 rounded p-1 text-fg-subtle hover:bg-elevated-strong hover:text-fg disabled:opacity-40"
      >
        <X size={13} />
      </button>
    </form>
  )
}

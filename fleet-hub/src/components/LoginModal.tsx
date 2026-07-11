import { useState } from 'react'
import type { FormEvent } from 'react'
import { X } from 'lucide-react'
import type { HostRuntime } from '../types'

interface Props {
  runtime: HostRuntime
  onSubmit: (username: string, password: string) => Promise<void>
  onClose: () => void
}

export function LoginModal({ runtime, onSubmit, onClose }: Props) {
  const [username, setUsername] = useState(runtime.config.username ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(username, password)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold">Sign in to {runtime.config.name}</h2>
            <p className="mt-0.5 font-mono text-xs text-zinc-500">{runtime.config.baseUrl}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X size={16} />
          </button>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-zinc-400">Username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoFocus={!username}
            autoComplete="username"
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs text-zinc-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus={!!username}
            autoComplete="current-password"
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
        </label>
        {error && <p className="mb-3 text-xs text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !username || !password}
          className="w-full rounded-md bg-zinc-100 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="mt-3 text-center text-[11px] text-zinc-600">
          Only the session token is stored — never your password.
        </p>
      </form>
    </div>
  )
}

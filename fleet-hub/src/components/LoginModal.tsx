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
  // CloudCLI is single-user: while the host has no account yet, this modal
  // runs first-time setup (POST /register) instead of sign-in.
  const setup = runtime.status === 'needs-setup'
  const [username, setUsername] = useState(runtime.config.username ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Mirrors CloudCLI's server-side rules (username ≥ 3, password ≥ 6).
  const invalid = setup && (username.length < 3 || password.length < 6 || confirm !== password)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(username, password)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : setup ? 'Setup failed' : 'Login failed')
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
        className="w-full max-w-sm rounded-xl border border-ink-800 bg-ink-900 p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-display text-sm font-semibold">
              {setup ? `Set up ${runtime.config.name}` : `Sign in to ${runtime.config.name}`}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-ink-500">{runtime.config.baseUrl}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
          >
            <X size={16} />
          </button>
        </div>
        {setup && (
          <p className="mb-4 text-xs text-ink-500">
            First run — create this host's single account. You'll use it to sign in from the hub
            and from the host's own UI.
          </p>
        )}
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-ink-400">
            Username{setup ? ' (min 3 characters)' : ''}
          </span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoFocus={!username}
            autoComplete="username"
            className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-brass-400/70"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs text-ink-400">
            Password{setup ? ' (min 6 characters)' : ''}
          </span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus={!!username}
            autoComplete={setup ? 'new-password' : 'current-password'}
            className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-brass-400/70"
          />
        </label>
        {setup && (
          <label className="mb-4 block">
            <span className="mb-1 block text-xs text-ink-400">Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-brass-400/70"
            />
            {confirm.length > 0 && confirm !== password && (
              <span className="mt-1 block text-xs text-rose-400">Passwords don't match</span>
            )}
          </label>
        )}
        {error && <p className="mb-3 text-xs text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !username || !password || invalid}
          className="w-full rounded-md bg-brass-400 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-brass-300 disabled:opacity-50"
        >
          {busy ? (setup ? 'Creating account…' : 'Signing in…') : setup ? 'Create account' : 'Sign in'}
        </button>
        <p className="mt-3 text-center text-[11px] text-ink-600">
          Only the session token is stored — never your password.
        </p>
      </form>
    </div>
  )
}

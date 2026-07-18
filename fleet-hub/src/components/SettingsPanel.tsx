import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Trash2, X, Radar, Monitor, Moon, Sun } from 'lucide-react'
import type { HostRuntime, Prefs } from '../types'
import type { NewHostInput } from '../hooks/useFleet'
import type { Theme } from '../lib/theme'
import { hostColor } from '../lib/format'
import { discoverLocalHosts, type DiscoveredHost } from '../lib/api'

interface Props {
  hosts: HostRuntime[]
  prefs: Prefs
  theme: Theme
  onChangeTheme: (theme: Theme) => void
  onAddHost: (input: NewHostInput) => void
  onRemoveHost: (hostId: string) => void
  onUpdatePrefs: (prefs: Prefs) => void
  onClearTokens: () => void
  onClose: () => void
}

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Monitor }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
]

const inputClass =
  'w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-brass-400/70'

export function SettingsPanel({
  hosts,
  prefs,
  theme,
  onChangeTheme,
  onAddHost,
  onRemoveHost,
  onUpdatePrefs,
  onClearTokens,
  onClose,
}: Props) {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [username, setUsername] = useState('')
  const [discovered, setDiscovered] = useState<DiscoveredHost[]>([])

  const existingBaseUrls = hosts.map((runtime) => runtime.config.baseUrl)
  // Probe well-known localhost ports whenever the set of configured hosts
  // changes, so a local fleet-server/CloudCLI can be added in one click.
  const existingKey = existingBaseUrls.join('|')
  useEffect(() => {
    let cancelled = false
    discoverLocalHosts(existingKey ? existingKey.split('|') : [])
      .then((found) => {
        if (!cancelled) setDiscovered(found)
      })
      .catch(() => {
        if (!cancelled) setDiscovered([])
      })
    return () => {
      cancelled = true
    }
  }, [existingKey])

  function handleAdd(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !baseUrl.trim()) return
    onAddHost({ name, baseUrl, username })
    setName('')
    setBaseUrl('')
    setUsername('')
  }

  function handleAddDiscovered(host: DiscoveredHost) {
    const label = host.kind === 'cloudcli' ? 'localhost (cloudcli)' : 'localhost'
    onAddHost({ name: label, baseUrl: host.baseUrl })
    setDiscovered((prev) => prev.filter((entry) => entry.baseUrl !== host.baseUrl))
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside
        onClick={(event) => event.stopPropagation()}
        className="slide-in absolute right-0 top-0 h-full w-96 max-w-full overflow-y-auto border-l border-ink-800 bg-ink-950 p-5"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
          >
            <X size={16} />
          </button>
        </div>

        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-faint">
          Appearance
        </h3>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="mb-5 grid grid-cols-3 gap-1 rounded-lg border border-line bg-surface p-1"
        >
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon
            const active = theme === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChangeTheme(option.value)}
                className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-accent text-on-accent'
                    : 'text-fg-muted hover:bg-elevated hover:text-fg'
                }`}
              >
                <Icon size={13} />
                {option.label}
              </button>
            )
          })}
        </div>

        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">Hosts</h3>
        <div className="mb-5 flex flex-col gap-2">
          {hosts.length === 0 && (
            <p className="text-xs text-ink-600">No hosts yet — add your first one below.</p>
          )}
          {hosts.map((runtime, index) => (
            <div
              key={runtime.config.id}
              className="flex items-center gap-2.5 rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: hostColor(index) }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink-200">{runtime.config.name}</div>
                <div className="truncate font-mono text-[11px] text-ink-500">
                  {runtime.config.baseUrl}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemoveHost(runtime.config.id)}
                title={`Remove ${runtime.config.name}`}
                className="rounded-md p-1.5 text-ink-600 transition-colors hover:bg-ink-800 hover:text-rose-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {discovered.length > 0 && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-brass-400/30 bg-brass-400/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-brass-300">
              <Radar size={12} /> Found on this machine
            </div>
            {discovered.map((host) => (
              <button
                key={host.baseUrl}
                type="button"
                onClick={() => handleAddDiscovered(host)}
                className="flex items-center justify-between gap-2 rounded-md border border-ink-800 bg-ink-900/60 px-3 py-2 text-left transition-colors hover:border-brass-400/60"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs text-ink-200">
                    {host.baseUrl}
                  </span>
                  <span className="block text-[11px] text-ink-500">
                    {host.kind === 'cloudcli' ? 'CloudCLI' : 'fleet-server'}
                    {host.version ? ` ${host.version}` : ''}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brass-300">
                  <Plus size={13} /> Add
                </span>
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleAdd} className="mb-6 flex flex-col gap-2.5">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name (e.g. vla-vm-1)"
            className={inputClass}
          />
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="Base URL (e.g. http://my-vm.example.net:3001)"
            className={`${inputClass} font-mono text-xs`}
          />
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username (optional, prefills login)"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={!name.trim() || !baseUrl.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brass-400 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-brass-300 disabled:opacity-50"
          >
            <Plus size={14} /> Add host
          </button>
        </form>

        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">
          Preferences
        </h3>
        <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-ink-300">
          <input
            type="checkbox"
            checked={prefs.hideCursor}
            onChange={(event) => onUpdatePrefs({ ...prefs, hideCursor: event.target.checked })}
            className="accent-brass-400"
          />
          Hide Cursor sessions (deep links to them are unreliable)
        </label>
        <label className="mb-5 flex cursor-pointer items-center gap-2 text-sm text-ink-300">
          <input
            type="checkbox"
            checked={prefs.soundAlerts}
            onChange={(event) => onUpdatePrefs({ ...prefs, soundAlerts: event.target.checked })}
            className="accent-brass-400"
          />
          Chime + desktop notification when a run finishes or needs approval
        </label>

        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">Security</h3>
        <button
          type="button"
          onClick={onClearTokens}
          className="rounded-md border border-ink-800 px-3 py-2 text-xs text-ink-400 transition-colors hover:border-rose-500/40 hover:text-rose-400"
        >
          Clear all stored tokens
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-600">
          A host token allows running code as your user on that machine. Tokens live only in this
          browser's localStorage; passwords are never stored.
        </p>
      </aside>
    </div>
  )
}

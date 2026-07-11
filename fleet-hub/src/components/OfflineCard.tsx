import { MoonStar, UserPlus } from 'lucide-react'
import type { HostRuntime } from '../types'

export function OfflineCard({ runtime, onSetup }: { runtime: HostRuntime; onSetup?: () => void }) {
  if (runtime.status === 'needs-setup') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-400">
        <UserPlus size={16} className="shrink-0 text-sky-400" />
        <div className="min-w-0">
          <span className="font-medium text-zinc-300">{runtime.config.name}</span> needs first-time
          setup —{' '}
          <button type="button" onClick={onSetup} className="text-sky-400 hover:underline">
            create its account
          </button>{' '}
          to start using it.
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-400">
      <MoonStar size={16} className="shrink-0 text-zinc-500" />
      <div className="min-w-0">
        <span className="font-medium text-zinc-300">{runtime.config.name}</span> is offline — if it
        is a remote VM it may be hibernating; wake it and run{' '}
        <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
          HOST=:: cloudcli
        </code>
      </div>
    </div>
  )
}

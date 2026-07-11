import type { FleetSession, HostRuntime } from '../types'
import { SessionRow } from './SessionRow'

interface Props {
  sessions: FleetSession[]
  hosts: HostRuntime[]
  onOpen: (item: FleetSession) => void
}

function SkeletonRow() {
  return (
    <div className="flex animate-pulse items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-4 py-3">
      <div className="flex-1 space-y-2">
        <div className="h-2.5 w-40 rounded bg-zinc-800" />
        <div className="h-3.5 w-72 max-w-full rounded bg-zinc-800" />
      </div>
      <div className="h-4 w-16 rounded-full bg-zinc-800" />
    </div>
  )
}

export function SessionList({ sessions, hosts, onOpen }: Props) {
  if (sessions.length === 0) {
    const anyLoading = hosts.some((host) => host.status === 'loading')
    if (anyLoading) {
      return (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )
    }
    return (
      <p className="py-16 text-center text-sm text-zinc-500">
        No sessions yet — they will appear here as soon as a host reports activity.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {sessions.map((item) => (
        <SessionRow key={item.key} item={item} onOpen={onOpen} />
      ))}
    </div>
  )
}

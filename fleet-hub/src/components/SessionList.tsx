import type { FleetSession, HostRuntime } from '../types'
import { SessionRow } from './SessionRow'

interface Props {
  sessions: FleetSession[]
  hosts: HostRuntime[]
  onOpen: (item: FleetSession) => void
  onArchive: (item: FleetSession) => void
}

function SkeletonRow() {
  return (
    <div className="flex animate-pulse items-center gap-3 rounded-lg border border-line/80 bg-surface/60 px-4 py-3">
      <div className="flex-1 space-y-2">
        <div className="h-2.5 w-40 rounded bg-elevated" />
        <div className="h-3.5 w-72 max-w-full rounded bg-elevated" />
      </div>
      <div className="h-4 w-16 rounded-full bg-elevated" />
    </div>
  )
}

export function SessionList({ sessions, hosts, onOpen, onArchive }: Props) {
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
      <p className="py-16 text-center text-sm text-fg-faint">
        No sessions yet — they will appear here as soon as a host reports activity.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {sessions.map((item) => (
        <SessionRow key={item.key} item={item} onOpen={onOpen} onArchive={onArchive} />
      ))}
    </div>
  )
}

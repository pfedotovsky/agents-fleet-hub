import { ExternalLink } from 'lucide-react'
import type { FleetSession } from '../types'
import { hostColor, isActive, relativeTime } from '../lib/format'
import { ProviderBadge } from './Messages'

interface Props {
  item: FleetSession
  onOpen: (item: FleetSession) => void
}

export function SessionRow({ item, onOpen }: Props) {
  const color = hostColor(item.hostColorIdx)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen(item)
      }}
      className={`group flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-4 py-3 backdrop-blur transition-colors hover:bg-zinc-800/60 ${
        item.stale ? 'opacity-50' : ''
      } ${item.justUpdated ? 'just-updated' : ''}`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="inline-flex shrink-0 items-center gap-1 font-medium text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            {item.hostName}
          </span>
          <span>·</span>
          <span className="truncate font-mono">{item.projectName}</span>
          {item.stale && (
            <span className="shrink-0 rounded bg-zinc-800 px-1 text-[10px] text-zinc-500">stale</span>
          )}
        </div>
        <div className="truncate text-sm text-zinc-100">
          {item.session.summary || 'Untitled session'}
        </div>
      </div>
      <ProviderBadge provider={item.session.provider} />
      {isActive(item.session.lastActivity) ? (
        <span
          title="Active in the last 2 minutes"
          className="inline-flex w-16 shrink-0 items-center justify-end gap-1.5 text-xs font-medium text-emerald-400"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          active
        </span>
      ) : (
        <span className="tnum w-16 shrink-0 text-right font-mono text-xs text-zinc-500">
          {relativeTime(item.session.lastActivity)}
        </span>
      )}
      <a
        href={item.href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        title="Open in this host's own CloudCLI UI"
        className="shrink-0 rounded-md p-1 text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-zinc-300 group-hover:opacity-100"
      >
        <ExternalLink size={14} />
      </a>
    </div>
  )
}

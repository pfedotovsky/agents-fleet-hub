import { MousePointer2, Sparkles, SquareCode, Terminal, TriangleAlert } from 'lucide-react'
import type { ComponentType } from 'react'
import type { NormalizedMessage, Provider } from '../types'
import { Markdown } from './Markdown'
import { ToolCall } from './ToolCall'

export const PROVIDER_META: Record<
  Provider,
  { label: string; color: string; Icon: ComponentType<{ size?: number; style?: React.CSSProperties }> }
> = {
  claude: { label: 'Claude', color: '#f97316', Icon: Sparkles },
  codex: { label: 'Codex', color: '#14b8a6', Icon: Terminal },
  cursor: { label: 'Cursor', color: '#a855f7', Icon: MousePointer2 },
  opencode: { label: 'OpenCode', color: '#94a3b8', Icon: SquareCode },
}

export function ProviderBadge({ provider }: { provider: Provider }) {
  const meta = PROVIDER_META[provider] ?? { label: provider, color: '#71717a', Icon: SquareCode }
  const isCursor = provider === 'cursor'
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ink-800 bg-ink-900 px-2 py-0.5 text-[11px] text-ink-400"
      title={isCursor ? 'Cursor IDE sessions may not open correctly in CloudCLI' : undefined}
    >
      <meta.Icon size={11} style={{ color: meta.color }} />
      {meta.label}
      {isCursor && <TriangleAlert size={11} className="text-amber-400" />}
    </span>
  )
}

export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  return JSON.stringify(content, null, 2)
}

/** Kinds that render as transcript entries; everything else is lifecycle/gateway. */
export const RENDERED_KINDS = new Set(['text', 'tool_use', 'thinking', 'error'])

export function MessageItem({ message }: { message: NormalizedMessage }) {
  if (message.kind === 'text') {
    const text = contentToText(message.content)
    if (message.role === 'user') {
      return (
        <div className="ml-10 self-end whitespace-pre-wrap break-words rounded-lg rounded-br-sm bg-ink-800 px-3.5 py-2.5 text-sm text-ink-100">
          {text}
        </div>
      )
    }
    return (
      <div className="mr-6">
        <Markdown>{text}</Markdown>
      </div>
    )
  }
  if (message.kind === 'thinking') {
    return (
      <details className="mr-10 text-xs text-ink-500">
        <summary className="cursor-pointer select-none italic">thinking…</summary>
        <div className="mt-1 whitespace-pre-wrap break-words border-l border-ink-800 pl-3 italic">
          {contentToText(message.content)}
        </div>
      </details>
    )
  }
  if (message.kind === 'tool_use') {
    return <ToolCall message={message} />
  }
  if (message.kind === 'error') {
    return (
      <div className="mr-10 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
        <TriangleAlert size={13} className="mt-0.5 shrink-0" />
        <span className="whitespace-pre-wrap break-words">{contentToText(message.content)}</span>
      </div>
    )
  }
  return null
}

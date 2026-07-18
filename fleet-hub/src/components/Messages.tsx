import { MousePointer2, Sparkles, SquareCode, Terminal, TriangleAlert } from 'lucide-react'
import type { ComponentType } from 'react'
import { motion } from 'motion/react'
import type { NormalizedMessage, Provider } from '../types'
import { messageReveal } from '../lib/motion'
import { AuthedImage } from './AuthedImage'
import { Markdown } from './Markdown'
import { ToolCall } from './ToolCall'

/** Where to fetch stored image attachments from (the message's host). */
export interface ImageSource {
  baseUrl: string
  hostId: string
}

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
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-fg-muted"
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

/**
 * Codex-style role marker above a turn: a small label + hairline, in a flat
 * single-column transcript (no chat bubbles). Assistant turns render bare
 * markdown with no marker so the agent's output reads as the primary content.
 */
function RoleLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
      {children}
    </div>
  )
}

export function MessageItem({
  message,
  imageSource,
}: {
  message: NormalizedMessage
  imageSource?: ImageSource
}) {
  if (message.kind === 'text') {
    const text = contentToText(message.content)
    if (message.role === 'user') {
      const images = imageSource ? message.images ?? [] : []
      return (
        <motion.div {...messageReveal} className="min-w-0">
          <RoleLabel>You</RoleLabel>
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {images.map((image, index) =>
                image.path ? (
                  <AuthedImage
                    key={image.path}
                    baseUrl={imageSource!.baseUrl}
                    hostId={imageSource!.hostId}
                    path={image.path}
                    name={image.name}
                  />
                ) : image.data?.startsWith('data:image/') ? (
                  // Messages sent from CloudCLI's own UI inline the image.
                  <img
                    key={index}
                    src={image.data}
                    alt={image.name ?? 'attachment'}
                    className="max-h-48 max-w-64 rounded-lg border border-line object-contain"
                  />
                ) : null,
              )}
            </div>
          )}
          {text && (
            <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-fg-secondary">
              {text}
            </div>
          )}
        </motion.div>
      )
    }
    return (
      <motion.div {...messageReveal} className="min-w-0">
        <Markdown>{text}</Markdown>
      </motion.div>
    )
  }
  if (message.kind === 'thinking') {
    return (
      <motion.details {...messageReveal} className="min-w-0 text-xs text-fg-faint">
        <summary className="cursor-pointer select-none italic">thinking…</summary>
        <div className="mt-1 whitespace-pre-wrap break-words border-l border-line pl-3 italic">
          {contentToText(message.content)}
        </div>
      </motion.details>
    )
  }
  if (message.kind === 'tool_use') {
    return (
      <motion.div {...messageReveal}>
        <ToolCall message={message} />
      </motion.div>
    )
  }
  if (message.kind === 'error') {
    return (
      <motion.div
        {...messageReveal}
        className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300"
      >
        <TriangleAlert size={13} className="mt-0.5 shrink-0" />
        <span className="whitespace-pre-wrap break-words">{contentToText(message.content)}</span>
      </motion.div>
    )
  }
  return null
}

import { useState } from 'react'
import { Check, Copy, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { PROVIDER_META } from './Messages'

export type ProviderReadiness =
  | { status: 'checking' }
  | {
      status: 'blocked'
      reason: 'missing-cli' | 'signed-out'
      detail?: string
    }

const PROVIDER_COMMANDS: Record<
  'claude' | 'codex',
  { install: string; login: string }
> = {
  claude: {
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    login: 'claude auth login',
  },
  codex: {
    install: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    login: 'codex login',
  },
}

interface Props {
  provider: 'claude' | 'codex'
  hostName: string
  readiness: ProviderReadiness
  onRetry: () => void
  onCopyError: () => void
}

export function ProviderReadinessBanner({
  provider,
  hostName,
  readiness,
  onRetry,
  onCopyError,
}: Props) {
  const [copied, setCopied] = useState(false)
  const meta = PROVIDER_META[provider]

  if (readiness.status === 'checking') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-fg-muted"
      >
        <LoaderCircle size={14} className="shrink-0 animate-spin" />
        Checking {meta.label} on {hostName}…
      </div>
    )
  }

  const missing = readiness.reason === 'missing-cli'
  const command = PROVIDER_COMMANDS[provider][missing ? 'install' : 'login']
  const title = missing ? `${meta.label} is not installed` : `${meta.label} needs sign-in`
  const instruction = missing
    ? `Install the provider-owned CLI on ${hostName}, then retry the check.`
    : `Sign in interactively on ${hostName}, then retry the check.`

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      onCopyError()
    }
  }

  return (
    <div
      role="alert"
      className="mb-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{title}</p>
          <p className="mt-0.5 text-xs text-fg-muted">{instruction}</p>
          {readiness.detail && (
            <p className="mt-1 text-xs text-fg-subtle">Host report: {readiness.detail}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 max-w-full overflow-x-auto rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg-secondary">
              {command}
            </code>
            <button
              type="button"
              onClick={() => void copyCommand()}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-line-strong hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy command'}
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <RefreshCw size={12} />
              Retry check
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { Check, ClipboardList, X } from 'lucide-react'
import type { PermissionRequest, PlanDecision } from '../types'
import { Markdown } from './Markdown'

/**
 * Right-hand drawer for a finished plan (ExitPlanMode request). Stays docked
 * while the chat scrolls on; the decision buttons live in the header so the
 * plan text gets the full remaining height.
 */
export function PlanPanel({
  request,
  onDecide,
  onClose,
}: {
  request: PermissionRequest
  onDecide: (requestId: string, decision: PlanDecision) => void
  onClose: () => void
}) {
  const input = request.input as { plan?: unknown } | null | undefined
  const plan = typeof input?.plan === 'string' ? input.plan : ''
  return (
    <aside className="flex h-full w-[26rem] shrink-0 flex-col border-l border-ink-800/80 xl:w-[32rem]">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-800 px-4 py-3">
        <ClipboardList size={15} className="shrink-0 text-indigo-300" />
        <h3 className="font-display min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">
          Plan ready for review
        </h3>
        <button
          type="button"
          onClick={onClose}
          title="Hide panel"
          className="shrink-0 rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 border-b border-ink-800 px-4 py-2.5">
        <button
          type="button"
          onClick={() => onDecide(request.requestId, 'build')}
          className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
        >
          <Check size={12} /> Approve &amp; build
        </button>
        <button
          type="button"
          onClick={() => onDecide(request.requestId, 'acceptEdits')}
          title="Approve the plan and auto-accept file edits during the build"
          className="inline-flex items-center gap-1 rounded-md border border-indigo-500/50 px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-600/10"
        >
          <Check size={12} /> Approve, auto-accept edits
        </button>
        <button
          type="button"
          onClick={() => onDecide(request.requestId, 'revise')}
          className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:bg-ink-800"
        >
          <X size={12} /> Revise
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px]">
        {plan ? (
          <Markdown>{plan}</Markdown>
        ) : (
          <p className="text-sm text-ink-500">The agent didn't attach any plan text.</p>
        )}
      </div>
    </aside>
  )
}

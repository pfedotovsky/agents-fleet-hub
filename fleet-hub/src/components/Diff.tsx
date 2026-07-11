import { diffLines } from 'diff'

interface Props {
  oldContent: string
  newContent: string
  filePath?: string
  badge?: string
  badgeColor?: 'green' | 'gray' | 'amber'
}

const BADGE_CLASS: Record<NonNullable<Props['badgeColor']>, string> = {
  green: 'bg-emerald-500/15 text-emerald-300',
  gray: 'bg-zinc-700/50 text-zinc-300',
  amber: 'bg-amber-500/15 text-amber-300',
}

function basename(p?: string): string {
  if (!p) return ''
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

export function Diff({ oldContent, newContent, filePath, badge, badgeColor = 'gray' }: Props) {
  const parts = diffLines(oldContent ?? '', newContent ?? '')
  let oldLine = 1
  let newLine = 1
  const rows: { sign: ' ' | '+' | '-'; text: string; oldNum?: number; newNum?: number }[] = []

  for (const part of parts) {
    const lines = part.value.replace(/\n$/, '').split('\n')
    for (const text of lines) {
      if (part.added) {
        rows.push({ sign: '+', text, newNum: newLine++ })
      } else if (part.removed) {
        rows.push({ sign: '-', text, oldNum: oldLine++ })
      } else {
        rows.push({ sign: ' ', text, oldNum: oldLine++, newNum: newLine++ })
      }
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-zinc-800">
      {(filePath || badge) && (
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5">
          {filePath && (
            <span className="truncate font-mono text-[11px] text-sky-400">{basename(filePath)}</span>
          )}
          {badge && (
            <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${BADGE_CLASS[badgeColor]}`}>
              {badge}
            </span>
          )}
        </div>
      )}
      <pre className="max-h-80 overflow-auto font-mono text-[11px] leading-relaxed">
        {rows.map((row, index) => (
          <div
            key={index}
            className={`flex ${
              row.sign === '+'
                ? 'bg-emerald-500/10'
                : row.sign === '-'
                  ? 'bg-rose-500/10'
                  : ''
            }`}
          >
            <span className="w-4 shrink-0 select-none text-center text-zinc-600">
              {row.sign === ' ' ? '' : row.sign}
            </span>
            <span
              className={`whitespace-pre-wrap break-all ${
                row.sign === '+'
                  ? 'text-emerald-300'
                  : row.sign === '-'
                    ? 'text-rose-300'
                    : 'text-zinc-400'
              }`}
            >
              {row.text || ' '}
            </span>
          </div>
        ))}
      </pre>
    </div>
  )
}

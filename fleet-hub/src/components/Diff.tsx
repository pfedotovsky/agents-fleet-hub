import { diffLines } from 'diff'

interface Props {
  oldContent?: string
  newContent?: string
  /** Pre-computed unified diff text (e.g. from /api/git/diff); overrides old/new content. */
  unified?: string
  filePath?: string
  badge?: string
  badgeColor?: 'green' | 'gray' | 'amber'
  /** Fill the parent instead of capping at max-h-80 (used by the git panel). */
  tall?: boolean
}

type Row = { sign: ' ' | '+' | '-' | '@'; text: string; oldNum?: number; newNum?: number }

/** Parses unified diff text into display rows, keeping hunk headers as separators. */
function rowsFromUnified(diffText: string): Row[] {
  const rows: Row[] = []
  let oldLine = 0
  let newLine = 0
  for (const line of diffText.split('\n')) {
    if (line.startsWith('@@')) {
      const header = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (header) {
        oldLine = Number(header[1])
        newLine = Number(header[2])
        rows.push({ sign: '@', text: line })
      }
      continue
    }
    if (/^(diff |index |--- |\+\+\+ |\\)/.test(line)) continue
    if (line.startsWith('+')) rows.push({ sign: '+', text: line.slice(1), newNum: newLine++ })
    else if (line.startsWith('-')) rows.push({ sign: '-', text: line.slice(1), oldNum: oldLine++ })
    else rows.push({ sign: ' ', text: line.slice(1), oldNum: oldLine++, newNum: newLine++ })
  }
  // A trailing newline in the diff text produces one empty context row — drop it.
  while (rows.length > 0 && rows[rows.length - 1].sign === ' ' && rows[rows.length - 1].text === '')
    rows.pop()
  return rows
}

const BADGE_CLASS: Record<NonNullable<Props['badgeColor']>, string> = {
  green: 'bg-emerald-500/15 text-emerald-300',
  gray: 'bg-elevated-strong/50 text-fg-secondary',
  amber: 'bg-amber-500/15 text-amber-300',
}

function basename(p?: string): string {
  if (!p) return ''
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

export function Diff({
  oldContent,
  newContent,
  unified,
  filePath,
  badge,
  badgeColor = 'gray',
  tall = false,
}: Props) {
  let rows: Row[]
  if (unified !== undefined) {
    rows = rowsFromUnified(unified)
  } else {
    const parts = diffLines(oldContent ?? '', newContent ?? '')
    let oldLine = 1
    let newLine = 1
    rows = []
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
  }

  return (
    <div
      className={`overflow-hidden rounded-md border border-line ${tall ? 'flex h-full flex-col' : ''}`}
    >
      {(filePath || badge) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface/80 px-2.5 py-1.5">
          {filePath && (
            <span className="truncate font-mono text-xs text-sky-400">{basename(filePath)}</span>
          )}
          {badge && (
            <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${BADGE_CLASS[badgeColor]}`}>
              {badge}
            </span>
          )}
        </div>
      )}
      <pre
        className={`overflow-auto font-mono text-xs leading-relaxed ${tall ? 'min-h-0 flex-1' : 'max-h-80'}`}
      >
        {rows.map((row, index) =>
          row.sign === '@' ? (
            <div key={index} className="bg-surface/80 px-4 py-0.5 text-sky-500/80">
              {row.text}
            </div>
          ) : (
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
              <span className="w-4 shrink-0 select-none text-center text-fg-subtle">
                {row.sign === ' ' ? '' : row.sign}
              </span>
              <span
                className={`whitespace-pre-wrap break-all ${
                  row.sign === '+'
                    ? 'text-emerald-300'
                    : row.sign === '-'
                      ? 'text-rose-300'
                      : 'text-fg-muted'
                }`}
              >
                {row.text || ' '}
              </span>
            </div>
          ),
        )}
      </pre>
    </div>
  )
}

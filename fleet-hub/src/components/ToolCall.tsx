import { useState } from 'react'
import {
  Check,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Copy,
  FileText,
  ListTodo,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { NormalizedMessage } from '../types'
import { Diff } from './Diff'
import { Markdown } from './Markdown'

type Category = 'edit' | 'bash' | 'search' | 'todo' | 'read' | 'agent' | 'plan' | 'default'

const CATEGORY: Record<string, Category> = {
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  ApplyPatch: 'edit',
  Bash: 'bash',
  Grep: 'search',
  Glob: 'search',
  Read: 'read',
  TodoWrite: 'todo',
  TodoRead: 'todo',
  Task: 'agent',
  ExitPlanMode: 'plan',
  exit_plan_mode: 'plan',
  // Codex synthesized tool names (server-normalized item types).
  FileChanges: 'edit',
  TodoList: 'todo',
  WebSearch: 'search',
  // Codex history replay shell tools (from ~/.codex/sessions rollouts).
  exec_command: 'bash',
  exec: 'bash',
  write_stdin: 'bash',
}

const BORDER: Record<Category, string> = {
  edit: 'border-l-amber-500',
  bash: 'border-l-emerald-500',
  search: 'border-l-ink-500',
  todo: 'border-l-violet-500',
  read: 'border-l-sky-500',
  agent: 'border-l-purple-500',
  plan: 'border-l-indigo-500',
  default: 'border-l-ink-600',
}

const ICON: Record<Category, ComponentType<{ size?: number; className?: string }>> = {
  edit: Pencil,
  bash: SquareTerminal,
  search: Search,
  todo: ListTodo,
  read: FileText,
  agent: Sparkles,
  plan: ClipboardList,
  default: Wrench,
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)
}

/** Codex history serializes toolInput as a JSON string — parse before reading fields. */
function parseInput(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return asObject(value)
}

/** Result content may be a string (claude) or an array of {type,text} parts (codex). */
function resultToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const obj = asObject(part)
        return typeof obj.text === 'string' ? obj.text : asString(part)
      })
      .join('')
  }
  return asString(content)
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="shrink-0 rounded p-1 text-ink-500 transition-colors hover:bg-ink-700 hover:text-ink-200"
      title="Copy"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

function TodoList({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter((t) => t.status === 'completed').length
  return (
    <div className="rounded-md border border-ink-800 bg-ink-900/50 p-2.5 text-xs">
      <div className="mb-1.5 text-xs font-medium text-ink-400">
        Todo list · {done}/{todos.length}
      </div>
      <ul className="space-y-1">
        {todos.map((todo, index) => (
          <li key={index} className="flex items-center gap-2">
            {todo.status === 'completed' ? (
              <Check size={12} className="shrink-0 text-emerald-400" />
            ) : todo.status === 'in_progress' ? (
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-400" />
            ) : (
              <CircleDot size={12} className="shrink-0 text-ink-600" />
            )}
            <span
              className={
                todo.status === 'completed'
                  ? 'text-ink-500 line-through'
                  : todo.status === 'in_progress'
                    ? 'font-medium text-ink-100'
                    : 'text-ink-400'
              }
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Collapsible({
  category,
  title,
  subtitle,
  defaultOpen,
  copyText,
  children,
}: {
  category: Category
  title: string
  subtitle?: string
  defaultOpen?: boolean
  copyText?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  const Icon = ICON[category]
  return (
    <div className={`border-l-2 ${BORDER[category]} rounded-r-md bg-ink-900/30`}>
      <div className="flex items-center gap-2 py-1 pl-2.5 pr-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-ink-600 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <Icon size={12} className="shrink-0 text-ink-500" />
          <span className="shrink-0 font-mono text-xs font-medium text-ink-300">{title}</span>
          {subtitle && <span className="truncate font-mono text-xs text-ink-600">{subtitle}</span>}
        </button>
        {copyText && <CopyButton text={copyText} />}
      </div>
      {open && <div className="px-2.5 pb-2">{children}</div>}
    </div>
  )
}

/** One-line tool row (Bash, Read, Grep, Glob). */
function OneLine({
  category,
  label,
  value,
  secondary,
  copyText,
  mono = true,
}: {
  category: Category
  label: string
  value: string
  secondary?: string
  copyText?: string
  mono?: boolean
}) {
  const Icon = ICON[category]
  const terminal = category === 'bash'
  return (
    <div
      className={`flex items-center gap-2 border-l-2 ${BORDER[category]} rounded-r-md py-1 pl-2.5 pr-2 ${
        terminal ? 'bg-emerald-950/20' : 'bg-ink-900/30'
      }`}
    >
      <Icon size={12} className={`shrink-0 ${terminal ? 'text-emerald-500' : 'text-ink-500'}`} />
      <span className="shrink-0 text-xs font-medium text-ink-500">{label}</span>
      <span
        className={`min-w-0 flex-1 truncate ${mono ? 'font-mono' : ''} text-xs ${
          terminal ? 'text-emerald-300' : 'text-ink-300'
        }`}
        title={value}
      >
        {value}
      </span>
      {secondary && <span className="shrink-0 truncate text-xs text-ink-600">{secondary}</span>}
      {copyText && <CopyButton text={copyText} />}
    </div>
  )
}

function ResultBlock({ content, isError }: { content: string; isError?: boolean }) {
  if (!content.trim()) return null
  return (
    <pre
      className={`mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-ink-800/60 bg-ink-950/50 p-2 font-mono text-xs ${
        isError ? 'text-rose-400' : 'text-ink-500'
      }`}
    >
      {content}
    </pre>
  )
}

export function ToolCall({ message }: { message: NormalizedMessage }) {
  const name = message.toolName ?? 'tool'
  const category = CATEGORY[name] ?? 'default'
  const input = parseInput(message.toolInput)
  // Codex live frames carry the result inline (output/exitCode on the
  // tool_use itself) instead of a separate tool_result frame.
  const result = message.toolResult
    ? { content: resultToText(message.toolResult.content), isError: message.toolResult.isError }
    : typeof message.output === 'string' && message.output !== ''
      ? { content: message.output, isError: typeof message.exitCode === 'number' && message.exitCode !== 0 }
      : undefined
  const filePath = asString(input.file_path || input.filePath || input.path)

  // Edit / Write / ApplyPatch → diff view.
  if (name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'ApplyPatch') {
    const isWrite = name === 'Write'
    const oldContent = isWrite ? '' : asString(input.old_string)
    const newContent = isWrite ? asString(input.content) : asString(input.new_string)
    return (
      <Collapsible
        category="edit"
        title={filePath ? filePath.split('/').pop() ?? filePath : name}
        subtitle={name}
        defaultOpen
      >
        <Diff
          oldContent={oldContent}
          newContent={newContent}
          filePath={filePath}
          badge={isWrite ? 'New' : name === 'ApplyPatch' ? 'Patch' : 'Edit'}
          badgeColor={isWrite ? 'green' : 'gray'}
        />
        {result?.isError && <ResultBlock content={result.content} isError />}
      </Collapsible>
    )
  }

  // TodoWrite / codex TodoList → checklist. Codex items use `text` +
  // `completed` instead of `content` + `status`; normalize both shapes.
  if (name === 'TodoWrite' || name === 'TodoRead' || name === 'TodoList') {
    const raw = Array.isArray(input.todos) ? input.todos : Array.isArray(input.items) ? input.items : []
    const todos = raw.flatMap((item): TodoItem[] => {
      const entry = asObject(item)
      const content = typeof entry.content === 'string' ? entry.content : asString(entry.text)
      if (!content) return []
      const status =
        entry.status === 'completed' || entry.status === 'in_progress' || entry.status === 'pending'
          ? entry.status
          : entry.completed
            ? ('completed' as const)
            : ('pending' as const)
      return [{ content, status }]
    })
    if (todos.length > 0) {
      return (
        <div className="border-l-2 border-l-violet-500 rounded-r-md bg-ink-900/30 py-1 pl-2.5 pr-2">
          <TodoList todos={todos} />
        </div>
      )
    }
  }

  // Bash (claude / codex live) and codex history shell tools → terminal
  // one-liner + collapsible output. Codex `exec` inputs are a raw JS snippet
  // driving tools.exec_command, so show the snippet itself as the command.
  if (name === 'Bash' || name === 'exec_command' || name === 'exec') {
    const rawCommand = input.command ?? input.cmd
    const command = Array.isArray(rawCommand)
      ? rawCommand.map(asString).join(' ')
      : asString(rawCommand) ||
        (typeof message.toolInput === 'string' ? message.toolInput.trim() : '')
    const description = asString(input.description)
    if (result && result.content.trim()) {
      return (
        <Collapsible category="bash" title="Bash" subtitle={description || command} copyText={command}>
          <div className="rounded bg-emerald-950/20 px-2 py-1 font-mono text-xs text-emerald-300">
            $ {command}
          </div>
          <ResultBlock content={result.content} isError={result.isError} />
        </Collapsible>
      )
    }
    return <OneLine category="bash" label="$" value={command} secondary={description} copyText={command} />
  }

  // ExitPlanMode → the proposed implementation plan, rendered as markdown.
  // The success result is just an ack ("User has approved…") — hide it.
  if (name === 'ExitPlanMode' || name === 'exit_plan_mode') {
    const plan = asString(input.plan)
    return (
      <Collapsible category="plan" title="Implementation plan" defaultOpen copyText={plan}>
        <div className="rounded-md border border-ink-800 bg-ink-900/50 p-3 text-[13px]">
          <Markdown>{plan}</Markdown>
        </div>
        {result?.isError && <ResultBlock content={result.content} isError />}
      </Collapsible>
    )
  }

  // Codex web search → one-line query.
  if (name === 'WebSearch') {
    return <OneLine category="search" label="Search" value={asString(input.query)} mono={false} />
  }

  // Codex file_change → per-file diffs. `changes` has been seen both as a
  // path-keyed record ({path: {add:{content}} | {update:{unified_diff}} |
  // {delete}}) and as an array of {path, kind}; unknown shapes fall through
  // to the generic raw-JSON renderer.
  if (name === 'FileChanges') {
    const changes: unknown = parseInput(message.toolInput)
    const entries: { path: string; kind: string; body?: React.ReactNode }[] = []
    if (Array.isArray(changes)) {
      for (const change of changes) {
        const entry = asObject(change)
        if (typeof entry.path === 'string') {
          entries.push({ path: entry.path, kind: asString(entry.kind) || 'update' })
        }
      }
    } else {
      for (const [path, op] of Object.entries(asObject(changes))) {
        const opObj = asObject(op)
        if ('add' in opObj) {
          entries.push({
            path,
            kind: 'add',
            body: (
              <Diff
                oldContent=""
                newContent={asString(asObject(opObj.add).content)}
                filePath={path}
                badge="New"
                badgeColor="green"
              />
            ),
          })
        } else if ('update' in opObj) {
          const update = asObject(opObj.update)
          const diffText = asString(update.unified_diff ?? update.unifiedDiff ?? update.diff)
          entries.push({
            path,
            kind: 'update',
            body: diffText ? (
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-ink-800/60 bg-ink-950/50 p-2 font-mono text-xs text-ink-400">
                {diffText}
              </pre>
            ) : undefined,
          })
        } else if ('delete' in opObj) {
          entries.push({ path, kind: 'delete' })
        }
      }
    }
    if (entries.length > 0) {
      return (
        <Collapsible
          category="edit"
          title="File changes"
          subtitle={entries.map((entry) => entry.path.split('/').pop() ?? entry.path).join(', ')}
          defaultOpen
        >
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.path}>
                <div className="mb-1 font-mono text-xs text-ink-500">
                  <span className="text-ink-400">{entry.kind}</span> · {entry.path}
                </div>
                {entry.body}
              </div>
            ))}
          </div>
        </Collapsible>
      )
    }
  }

  // Read / Grep / Glob → one-line.
  if (name === 'Read') return <OneLine category="read" label="Read" value={filePath} />
  if (name === 'Grep')
    return (
      <OneLine
        category="search"
        label="Grep"
        value={asString(input.pattern)}
        secondary={input.path ? `in ${asString(input.path)}` : undefined}
      />
    )
  if (name === 'Glob') return <OneLine category="search" label="Glob" value={asString(input.pattern)} />

  // Fallback: generic collapsible with raw input + result.
  const inputText = asString(message.toolInput)
  return (
    <Collapsible
      category={category}
      title={name}
      subtitle={filePath || undefined}
      copyText={inputText}
    >
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-ink-400">
        {inputText}
      </pre>
      {result && <ResultBlock content={result.content} isError={result.isError} />}
    </Collapsible>
  )
}

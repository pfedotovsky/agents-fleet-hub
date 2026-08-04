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
  ViewImage: 'read',
  ContextCompaction: 'read',
  TodoWrite: 'todo',
  TodoRead: 'todo',
  CodeMode: 'default',
  Task: 'agent',
  Agent: 'agent',
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
      className="shrink-0 rounded p-1 text-fg-faint transition-colors hover:bg-elevated-strong hover:text-fg"
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

function TodoList({ todos, explanation }: { todos: TodoItem[]; explanation?: string }) {
  const done = todos.filter((t) => t.status === 'completed').length
  return (
    <div className="rounded-md border border-line bg-surface/50 p-2.5 text-xs">
      {explanation && <p className="mb-2 text-fg-muted">{explanation}</p>}
      <div className="mb-1.5 text-xs font-medium text-fg-muted">
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
              <CircleDot size={12} className="shrink-0 text-fg-subtle" />
            )}
            <span
              className={
                todo.status === 'completed'
                  ? 'text-fg-faint line-through'
                  : todo.status === 'in_progress'
                    ? 'font-medium text-fg'
                    : 'text-fg-muted'
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
    <div className="rounded-md border border-line bg-surface/30">
      <div className="flex items-center gap-2 py-1 pl-2.5 pr-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-fg-subtle transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <Icon size={12} className="shrink-0 text-fg-faint" />
          <span className="shrink-0 font-mono text-xs font-medium text-fg-secondary">{title}</span>
          {subtitle && <span className="truncate font-mono text-xs text-fg-subtle">{subtitle}</span>}
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
      className={`flex items-center gap-2 rounded-md border border-line py-1 pl-2.5 pr-2 ${
        terminal ? 'bg-canvas/50' : 'bg-surface/30'
      }`}
    >
      <Icon size={12} className="shrink-0 text-fg-faint" />
      <span className="shrink-0 text-xs font-medium text-fg-faint">{label}</span>
      <span
        className={`min-w-0 flex-1 truncate ${mono ? 'font-mono' : ''} text-xs text-fg-secondary`}
        title={value}
      >
        {value}
      </span>
      {secondary && <span className="shrink-0 truncate text-xs text-fg-subtle">{secondary}</span>}
      {copyText && <CopyButton text={copyText} />}
    </div>
  )
}

function ResultBlock({ content, isError }: { content: string; isError?: boolean }) {
  if (!content.trim()) return null
  return (
    <pre
      className={`mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-line/60 bg-canvas/50 p-2 font-mono text-xs ${
        isError ? 'text-rose-400' : 'text-fg-faint'
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
      const explanation = typeof input.explanation === 'string' ? input.explanation : undefined
      return <TodoList todos={todos} explanation={explanation} />
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
        <div className="rounded-md border border-line bg-surface/50 p-3 text-[13px]">
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

  if (name === 'CodeMode') {
    return (
      <OneLine
        category="default"
        label="Code Mode"
        value="Internal tool orchestration"
        mono={false}
      />
    )
  }

  if (name === 'Agent') {
    const action = asString(input.action)
    const activityKind = asString(input.activityKind)
    const title = activityKind
      ? ({
          started: 'Agent started',
          interacted: 'Agent interacted',
          interrupted: 'Agent interrupted',
        }[activityKind] ?? 'Agent activity')
      : ({
          spawnAgent: 'Spawn agent',
          sendInput: 'Send input',
          resumeAgent: 'Resume agent',
          wait: 'Wait for agents',
          closeAgent: 'Close agent',
        }[action] ?? 'Agent')
    const prompt = asString(input.prompt)
    const taskName = asString(input.taskName)
    const agents = Array.isArray(input.agents) ? input.agents : []
    const receiverThreadIds = Array.isArray(input.receiverThreadIds)
      ? input.receiverThreadIds.filter((value): value is string => typeof value === 'string')
      : []
    const statusByThread = new Map(
      agents.flatMap((value): Array<[string, { status: string; message: string }]> => {
        const agent = asObject(value)
        const threadId = asString(agent.threadId)
        if (!threadId) return []
        return [[threadId, { status: asString(agent.status), message: asString(agent.message) }]]
      }),
    )
    const threadIds = [...new Set([...receiverThreadIds, ...statusByThread.keys()])]
    const activityThreadId = asString(input.agentThreadId)
    if (activityThreadId && !threadIds.includes(activityThreadId)) threadIds.push(activityThreadId)
    const model = asString(input.model)
    const effort = asString(input.reasoningEffort)
    const agentPath = asString(input.agentPath)
    return (
      <Collapsible
        category="agent"
        title={title}
        subtitle={
          [taskName, agentPath, model, effort].filter(Boolean).join(' · ')
          || message.server
          || undefined
        }
        defaultOpen={message.status === 'inProgress'}
        copyText={prompt || undefined}
      >
        {prompt && <p className="text-xs leading-relaxed text-fg-muted">{prompt}</p>}
        {threadIds.length > 0 && (
          <div className="divide-y divide-line/70">
            {threadIds.map((threadId) => {
              const agent = statusByThread.get(threadId)
              return (
                <div key={threadId} className="flex min-w-0 items-start justify-between gap-3 py-1.5 text-xs">
                  <span className="truncate font-mono text-fg-muted" title={threadId}>
                    {threadId}
                  </span>
                  <span className="shrink-0 text-right text-fg-faint">
                    {agent?.message || agent?.status || (activityKind ? activityKind : 'pending')}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {result && <ResultBlock content={result.content} isError={result.isError} />}
      </Collapsible>
    )
  }

  // Codex file_change → per-file diffs. Current app-server and rollout items
  // use an array of {path, kind:{type,move_path?}, diff}; older history can be
  // a path-keyed operation record. Unknown shapes fall through to raw JSON.
  if (name === 'FileChanges') {
    const changes: unknown = parseInput(message.toolInput)
    const entries: { path: string; kind: string; body?: React.ReactNode }[] = []
    if (Array.isArray(changes)) {
      for (const change of changes) {
        const entry = asObject(change)
        if (typeof entry.path === 'string') {
          const kind = asObject(entry.kind)
          const kindType = kind.type === 'add' || kind.type === 'delete' || kind.type === 'update'
            ? kind.type
            : 'update'
          const movePath = kindType === 'update' ? asString(kind.move_path) : ''
          const diff = asString(entry.diff)
          const badge = movePath ? 'Move' : kindType === 'add' ? 'New' : kindType === 'delete' ? 'Delete' : 'Edit'
          entries.push({
            path: entry.path,
            kind: movePath ? `move → ${movePath}` : kindType,
            body: diff ? (
              <Diff
                unified={diff}
                filePath={entry.path}
                badge={badge}
                badgeColor={kindType === 'add' ? 'green' : kindType === 'delete' ? 'amber' : 'gray'}
              />
            ) : undefined,
          })
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
              <Diff unified={diffText} filePath={path} badge="Edit" badgeColor="gray" />
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
                {entry.body ?? (
                  <div className="font-mono text-xs text-fg-faint">
                    <span className="text-fg-muted">{entry.kind}</span> · {entry.path}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Collapsible>
      )
    }
  }

  // Read / Grep / Glob → one-line.
  if (name === 'ContextCompaction')
    return (
      <OneLine
        category="read"
        label="Context compacted"
        value="Earlier messages were summarized"
        mono={false}
      />
    )
  if (name === 'ViewImage') return <OneLine category="read" label="View image" value={filePath} />
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
      subtitle={message.server || filePath || undefined}
      copyText={inputText}
    >
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">
        {inputText}
      </pre>
      {result && <ResultBlock content={result.content} isError={result.isError} />}
    </Collapsible>
  )
}

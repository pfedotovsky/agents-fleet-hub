import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { RotateCw, SquareTerminal, X } from 'lucide-react'
import type { FleetSession } from '../types'
import { getToken } from '../lib/storage'
import { ShellSocket, type ShellSocketState } from '../lib/shellSocket'
import { PROVIDER_META } from './Messages'

/**
 * Fixed dark terminal theme. A PTY stream is raw ANSI tuned for a dark
 * background (the CLIs emit bright colours + dim text that wash out on white),
 * so the terminal keeps its own dark surface regardless of the app theme — the
 * same convention as VS Code's integrated terminal. Values mirror the dark ink
 * ramp in index.css so it still reads as part of the hub.
 */
const TERMINAL_THEME = {
  background: '#0a0a0a',
  foreground: '#e5e5e5',
  cursor: '#e5e5e5',
  cursorAccent: '#0a0a0a',
  selectionBackground: 'rgba(255,255,255,0.18)',
  black: '#141414',
  red: '#fb7185',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#38bdf8',
  white: '#d4d4d4',
  brightBlack: '#525252',
  brightRed: '#fda4af',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#7dd3fc',
  brightWhite: '#fafafa',
} as const

interface Props {
  target: FleetSession
  onBack: () => void
}

/**
 * Live terminal proxy for a session: streams the agent CLI running in a real PTY
 * on the host over the `/shell` WebSocket (see shell-websocket.service.ts). For
 * an existing session it runs `claude --resume <id>` / `codex resume <id>`; a
 * draft (empty id) starts a fresh CLI. This is the full-fidelity escape hatch
 * next to the structured ChatPane — the same on-host login, driven interactively.
 */
export function TerminalPanel({ target, onBack }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<ShellSocket | null>(null)
  const [state, setState] = useState<ShellSocketState>('connecting')
  // Bumped to force a full teardown + reconnect (the "restart" button); the
  // server kills the old PTY when the same key re-inits with forceRestart.
  const [restartNonce, setRestartNonce] = useState(0)

  const provider = target.session.provider
  const providerLabel = PROVIDER_META[provider]?.label ?? provider
  const hasSession = target.session.id !== ''

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const term = new Terminal({
      fontFamily: '"IBM Plex Mono", ui-monospace, "SF Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: TERMINAL_THEME,
      scrollback: 5000,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    // Make URLs the CLI prints (docs links, and a real login URL during auth)
    // clickable — opens in a new tab. This replaces the old server-driven
    // "Login URL" banner, whose URL-in-the-stream heuristic false-fired on any
    // link in a resumed transcript (PR/doc URLs). Genuine login URLs are still
    // reachable here, without guessing which URL is one.
    term.loadAddon(new WebLinksAddon())
    term.open(mount)
    termRef.current = term
    fitRef.current = fitAddon

    const fit = () => {
      try {
        fitAddon.fit()
      } catch {
        // Element not laid out yet (zero size) — the ResizeObserver retries.
      }
    }
    fit()

    // Keystrokes → PTY.
    const dataSub = term.onData((data) => socketRef.current?.input(data))

    // A user-triggered restart (restartNonce bump) remounts this effect; send
    // forceRestart on its first init only, so a transient socket drop within the
    // same mount reattaches to the live PTY instead of killing the CLI.
    let didFirstInit = false

    const socket = new ShellSocket(
      target.baseUrl,
      () => getToken(target.hostId),
      (message) => {
        if (message.type === 'output' && typeof message.data === 'string') {
          term.write(message.data)
        } else if (message.type === 'error' && typeof message.message === 'string') {
          term.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`)
        }
        // `auth_url` frames are intentionally ignored: the server flags every URL
        // in the stream as a possible login URL (false-firing on any link in a
        // resumed transcript). URLs are made clickable by WebLinksAddon instead.
      },
      (next) => {
        setState(next)
        if (next === 'open') {
          fit()
          // The server replays its scrollback buffer on reconnect; reset first
          // so a re-init repaints cleanly instead of duplicating output.
          term.reset()
          socketRef.current?.init({
            projectPath: target.projectPath,
            sessionId: hasSession ? target.session.id : undefined,
            hasSession,
            provider,
            cols: term.cols,
            rows: term.rows,
            forceRestart: !didFirstInit && restartNonce > 0,
          })
          didFirstInit = true
          term.focus()
        }
      },
    )
    socketRef.current = socket
    socket.connect()

    // Keep the PTY's dimensions in sync with the panel as it's resized/docked.
    const onResize = () => {
      fit()
      socketRef.current?.resize(term.cols, term.rows)
    }
    const observer = new ResizeObserver(() => onResize())
    observer.observe(mount)

    return () => {
      observer.disconnect()
      dataSub.dispose()
      socket.close()
      term.dispose()
      socketRef.current = null
      termRef.current = null
      fitRef.current = null
    }
    // restartNonce forces a fresh terminal + socket; target identity keys the pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.baseUrl, target.hostId, target.projectPath, target.session.id, provider, restartNonce])

  const stateLabel =
    state === 'open' ? 'connected' : state === 'connecting' ? 'connecting…' : 'disconnected'
  const stateColor =
    state === 'open' ? 'bg-success' : state === 'connecting' ? 'bg-warning' : 'bg-danger'

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[#0a0a0a]">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <SquareTerminal size={15} className="shrink-0 text-fg-faint" />
        <span className="text-xs font-medium text-fg-secondary">Terminal</span>
        <span className="truncate font-mono text-[11px] text-fg-faint">
          {hasSession ? `${providerLabel} · resume` : `${providerLabel} · new`}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-fg-faint">
          <span className={`h-1.5 w-1.5 rounded-full ${stateColor}`} />
          {stateLabel}
        </span>
        <button
          type="button"
          onClick={() => setRestartNonce((n) => n + 1)}
          title="Restart the terminal session"
          className="shrink-0 rounded-md p-1.5 text-fg-faint transition-colors hover:bg-elevated hover:text-fg"
        >
          <RotateCw size={14} />
        </button>
        <button
          type="button"
          onClick={onBack}
          title="Close terminal"
          className="shrink-0 rounded-md p-1.5 text-fg-faint transition-colors hover:bg-elevated hover:text-fg"
        >
          <X size={14} />
        </button>
      </header>

      <div
        ref={mountRef}
        onClick={() => termRef.current?.focus()}
        className="min-h-0 flex-1 overflow-hidden p-2"
      />
    </div>
  )
}

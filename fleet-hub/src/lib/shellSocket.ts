export type ShellSocketState = 'connecting' | 'open' | 'closed'

/** The `init` payload the server's /shell handler expects (see shell-websocket.service.ts). */
export interface ShellInit {
  projectPath: string
  /** Provider session id to resume; omit/empty to start a fresh CLI session. */
  sessionId?: string
  hasSession: boolean
  /** 'claude' | 'codex' | 'cursor' | 'opencode'. */
  provider: string
  cols: number
  rows: number
  /** Kill any existing PTY for this project+session and spawn a fresh CLI. */
  forceRestart?: boolean
}

/** Frames the server pushes down the shell socket. */
export type ShellServerMessage =
  | { type: 'output'; data: string }
  | { type: 'error'; message: string }
  | { type: 'auth_url'; url: string; autoOpen?: boolean }
  | { type: string; [key: string]: unknown }

const RECONNECT_DELAY_MS = 3000

/**
 * One PTY WebSocket to a fleet-server host (`/shell?token=…`). Mirrors
 * {@link ChatSocket}: reconnects with a fixed delay until close() is called,
 * and the owner re-sends `init` on every open (the server replays its scrollback
 * buffer when the same project+session reconnects within its 30-min window).
 */
export class ShellSocket {
  private ws: WebSocket | null = null
  private closed = false
  private retryTimer: number | undefined
  private readonly baseUrl: string
  private readonly getToken: () => string | undefined
  private readonly onMessage: (message: ShellServerMessage) => void
  private readonly onStateChange: (state: ShellSocketState) => void

  constructor(
    baseUrl: string,
    getToken: () => string | undefined,
    onMessage: (message: ShellServerMessage) => void,
    onStateChange: (state: ShellSocketState) => void,
  ) {
    this.baseUrl = baseUrl
    this.getToken = getToken
    this.onMessage = onMessage
    this.onStateChange = onStateChange
  }

  connect(): void {
    if (this.closed) return
    const token = this.getToken()
    if (!token) {
      this.onStateChange('closed')
      return
    }
    this.onStateChange('connecting')
    const wsUrl = `${this.baseUrl.replace(/^http/i, 'ws')}/shell?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(wsUrl)
    this.ws = ws
    ws.onopen = () => this.onStateChange('open')
    ws.onmessage = (event) => {
      try {
        this.onMessage(JSON.parse(event.data as string) as ShellServerMessage)
      } catch {
        // Non-JSON frames are not part of the protocol; ignore.
      }
    }
    ws.onerror = () => ws.close()
    ws.onclose = () => {
      this.ws = null
      this.onStateChange('closed')
      if (!this.closed) {
        this.retryTimer = window.setTimeout(() => this.connect(), RECONNECT_DELAY_MS)
      }
    }
  }

  private sendJson(payload: unknown): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
      return true
    }
    return false
  }

  /** Spawns (or reconnects to) the PTY for this project/session. */
  init(payload: ShellInit): boolean {
    return this.sendJson({ type: 'init', ...payload })
  }

  /** Forwards raw keystrokes to the PTY. */
  input(data: string): boolean {
    return this.sendJson({ type: 'input', data })
  }

  resize(cols: number, rows: number): boolean {
    return this.sendJson({ type: 'resize', cols, rows })
  }

  close(): void {
    this.closed = true
    window.clearTimeout(this.retryTimer)
    this.ws?.close()
    this.ws = null
  }
}

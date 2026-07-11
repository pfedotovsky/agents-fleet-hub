import type { ChatEvent, PermissionMode } from '../types'

export type SocketState = 'connecting' | 'open' | 'closed'

const RECONNECT_DELAY_MS = 3000

/**
 * One chat WebSocket to a CloudCLI host (`/ws?token=…`). Reconnects with a
 * fixed delay until close() is called; the owner re-subscribes on every open.
 */
export class ChatSocket {
  private ws: WebSocket | null = null
  private closed = false
  private retryTimer: number | undefined
  private readonly baseUrl: string
  private readonly getToken: () => string | undefined
  private readonly onEvent: (event: ChatEvent) => void
  private readonly onStateChange: (state: SocketState) => void

  constructor(
    baseUrl: string,
    getToken: () => string | undefined,
    onEvent: (event: ChatEvent) => void,
    onStateChange: (state: SocketState) => void,
  ) {
    this.baseUrl = baseUrl
    this.getToken = getToken
    this.onEvent = onEvent
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
    const wsUrl = `${this.baseUrl.replace(/^http/i, 'ws')}/ws?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(wsUrl)
    this.ws = ws
    ws.onopen = () => this.onStateChange('open')
    ws.onmessage = (event) => {
      try {
        this.onEvent(JSON.parse(event.data as string) as ChatEvent)
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

  subscribe(sessionId: string, lastSeq = 0): boolean {
    return this.sendJson({ type: 'chat.subscribe', sessions: [{ sessionId, lastSeq }] })
  }

  sendChat(
    sessionId: string,
    content: string,
    options: { permissionMode?: PermissionMode; model?: string; effort?: string } = {},
  ): boolean {
    return this.sendJson({ type: 'chat.send', sessionId, content, options })
  }

  abort(sessionId: string): boolean {
    return this.sendJson({ type: 'chat.abort', sessionId })
  }

  respondPermission(requestId: string, allow: boolean): boolean {
    return this.sendJson({ type: 'chat.permission-response', requestId, allow })
  }

  close(): void {
    this.closed = true
    window.clearTimeout(this.retryTimer)
    this.ws?.close()
    this.ws = null
  }
}

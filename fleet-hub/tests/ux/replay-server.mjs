import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const HOST = '127.0.0.1'
const PORT = Number(process.env.REPLAY_PORT ?? 4174)
const SESSION_ID = 'session-reload-001'
const PROJECT_ID = 'project-sanitized'
const TOKEN = 'fixture-token-not-a-secret'

const transcript = [
  {
    id: 'message-user-001',
    sessionId: SESSION_ID,
    timestamp: '2026-01-01T10:00:00.000Z',
    provider: 'claude',
    kind: 'text',
    role: 'user',
    content: 'Check the deterministic replay.',
  },
  {
    id: 'message-assistant-001',
    sessionId: SESSION_ID,
    timestamp: '2026-01-01T10:00:01.000Z',
    provider: 'claude',
    kind: 'text',
    role: 'assistant',
    content: 'Replay response is stable.',
  },
]

let observation = { authorizationHeaders: [], socketMessages: [] }

function sendJson(response, body, status = 200) {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  })
  response.end(JSON.stringify(body))
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`)
  if (request.method === 'OPTIONS') return sendJson(response, {})

  if (url.pathname === '/__replay/reset' && request.method === 'POST') {
    observation = { authorizationHeaders: [], socketMessages: [] }
    return sendJson(response, { success: true })
  }
  if (url.pathname === '/__replay/observations') return sendJson(response, observation)

  if (request.headers.authorization) {
    observation.authorizationHeaders.push(request.headers.authorization)
  }
  if (url.pathname === '/health') {
    return sendJson(response, { status: 'ok', version: 'fixture' })
  }
  if (url.pathname === '/api/auth/status') {
    return sendJson(response, { needsSetup: false, localAuthBypass: true })
  }
  if (url.pathname === '/api/auth/local-token' && request.method === 'POST') {
    return sendJson(response, { token: TOKEN })
  }
  if (url.pathname === '/api/projects') {
    return sendJson(response, [
      {
        projectId: PROJECT_ID,
        path: 'sanitized-project',
        displayName: 'Sanitized project',
        fullPath: '/fixtures/sanitized-project',
        isStarred: false,
        sessions: [
          {
            id: SESSION_ID,
            provider: 'claude',
            summary: 'Replay transcript fidelity',
            messageCount: 0,
            lastActivity: '2026-01-01T10:00:01.000Z',
          },
        ],
        sessionMeta: { hasMore: false, total: 1 },
      },
    ])
  }
  if (url.pathname === '/api/providers/sessions/running') {
    return sendJson(response, { success: true, data: { sessions: [] } })
  }
  if (url.pathname === `/api/providers/sessions/${SESSION_ID}/messages`) {
    return sendJson(response, {
      success: true,
      data: {
        messages: transcript,
        total: transcript.length,
        hasMore: false,
        offset: 0,
        limit: 50,
      },
    })
  }
  if (url.pathname === `/api/projects/${PROJECT_ID}/sessions/${SESSION_ID}/token-usage`) {
    return sendJson(response, { used: 0, total: 0 })
  }
  if (url.pathname === '/api/providers/claude/models') {
    return sendJson(response, {
      success: true,
      data: {
        models: {
          OPTIONS: [{ value: 'fixture', label: 'Fixture model' }],
          DEFAULT: 'fixture',
        },
      },
    })
  }

  return sendJson(response, { error: { message: `Unhandled replay route: ${url.pathname}` } }, 501)
})

const sockets = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`)
  if (url.pathname !== '/ws' || url.searchParams.get('token') !== TOKEN) {
    socket.destroy()
    return
  }
  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    sockets.emit('connection', webSocket, request)
  })
})

sockets.on('connection', (socket) => {
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    observation.socketMessages.push(message)
    if (message.type === 'chat.subscribe') {
      socket.send(
        JSON.stringify({
          type: 'chat_subscribed',
          sessionId: message.sessions?.[0]?.sessionId,
          isProcessing: false,
          lastSeq: 0,
          pendingPermissions: [],
        }),
      )
    }
  })
})

server.listen(PORT, HOST)

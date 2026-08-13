import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/representative-session.json', import.meta.url), 'utf8'),
)
const port = Number(process.env.FAKE_HOST_PORT ?? 4312)
const requests = []
const socketMessages = []
const createdSessionId = 'fixture-created-session'
let createdSession = null
let createdMessages = []

async function requestJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function projectState() {
  if (!createdSession) return fixture.project
  return {
    ...fixture.project,
    sessions: [createdSession, ...fixture.project.sessions],
    sessionMeta: {
      ...fixture.project.sessionMeta,
      total: fixture.project.sessionMeta.total + 1,
    },
  }
}

function json(response, status, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  })
  response.end(status === 204 ? undefined : JSON.stringify(body))
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  requests.push(`${request.method} ${url.pathname}${url.search}`)
  if (request.method === 'OPTIONS') return json(response, 204, {})
  if (url.pathname === '/health') return json(response, 200, { status: 'ok', version: 'fixture' })
  if (request.method === 'POST' && url.pathname === '/__reset') {
    requests.length = 0
    socketMessages.length = 0
    createdSession = null
    createdMessages = []
    return json(response, 204, {})
  }
  if (url.pathname === '/__state') {
    return json(response, 200, { requests, socketMessages, createdSession, createdMessages })
  }
  if (url.pathname === '/api/auth/status') {
    return json(response, 200, { needsSetup: false, localAuthBypass: false })
  }
  if (url.pathname === '/api/projects') return json(response, 200, [projectState()])
  if (url.pathname === '/api/providers/sessions/running') {
    return json(response, 200, { success: true, data: { sessions: [] } })
  }
  if (request.method === 'POST' && url.pathname === '/api/providers/sessions') {
    const body = await requestJson(request)
    createdSession = {
      id: createdSessionId,
      provider: body.provider,
      summary: 'Synthetic streamed session',
      messageCount: 0,
      lastActivity: '2026-01-03T04:05:00.000Z',
    }
    createdMessages = []
    return json(response, 200, {
      success: true,
      data: {
        sessionId: createdSessionId,
        provider: body.provider,
        projectPath: body.projectPath,
      },
    })
  }
  if (url.pathname.endsWith('/token-usage')) return json(response, 200, { used: 0, total: 0 })
  if (url.pathname === '/api/providers/sessions/fixture-session/messages') {
    return json(response, 200, {
      success: true,
      data: {
        messages: fixture.messages,
        total: fixture.messages.length,
        hasMore: false,
        offset: Number(url.searchParams.get('offset') ?? 0),
        limit: Number(url.searchParams.get('limit') ?? 50),
      },
    })
  }
  if (url.pathname === `/api/providers/sessions/${createdSessionId}/messages`) {
    return json(response, 200, {
      success: true,
      data: {
        messages: createdMessages,
        total: createdMessages.length,
        hasMore: false,
        offset: Number(url.searchParams.get('offset') ?? 0),
        limit: Number(url.searchParams.get('limit') ?? 50),
      },
    })
  }
  if (/^\/api\/providers\/(claude|codex)\/auth\/status$/.test(url.pathname)) {
    return json(response, 200, { data: { installed: true, authenticated: true } })
  }
  if (/^\/api\/providers\/(claude|codex)\/models$/.test(url.pathname)) {
    return json(response, 200, {
      OPTIONS: [{ value: 'fixture-model', label: 'Fixture model' }],
      DEFAULT: 'fixture-model',
    })
  }
  return json(response, 404, { error: { message: `Unhandled fixture route: ${url.pathname}` } })
})

const sockets = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  if (url.pathname !== '/ws' || url.searchParams.get('token') !== 'fixture-token') {
    socket.destroy()
    return
  }
  sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client))
})
sockets.on('connection', (socket) => {
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    socketMessages.push(message)
    if (message.type === 'chat.subscribe') {
      const sessionId = message.sessions?.[0]?.sessionId
      socket.send(
        JSON.stringify({
          kind: 'chat_subscribed',
          sessionId,
          isProcessing: false,
          lastSeq: 0,
          pendingPermissions: [],
        }),
      )
      return
    }
    if (message.type !== 'chat.send' || message.sessionId !== createdSessionId) return

    createdMessages = [
      {
        id: 'fixture-created-user-1',
        sessionId: createdSessionId,
        timestamp: '2026-01-03T04:05:01.000Z',
        provider: 'codex',
        kind: 'text',
        role: 'user',
        content: message.content,
      },
      {
        id: 'fixture-created-assistant-1',
        sessionId: createdSessionId,
        timestamp: '2026-01-03T04:05:02.000Z',
        provider: 'codex',
        kind: 'text',
        role: 'assistant',
        content: 'Synthetic stream finished successfully.',
      },
    ]
    socket.send(
      JSON.stringify({
        kind: 'chat_subscribed',
        sessionId: createdSessionId,
        isProcessing: true,
        lastSeq: 0,
        pendingPermissions: [],
      }),
    )
    setTimeout(() => {
      if (socket.readyState !== 1) return
      socket.send(
        JSON.stringify({
          ...createdMessages[1],
          id: 'fixture-created-assistant-live-1',
          seq: 1,
        }),
      )
    }, 100)
    setTimeout(() => {
      if (socket.readyState !== 1) return
      socket.send(
        JSON.stringify({
          kind: 'complete',
          sessionId: createdSessionId,
          seq: 2,
          success: true,
        }),
      )
    }, 200)
  })
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Sanitized UX fixture host listening on ${port}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

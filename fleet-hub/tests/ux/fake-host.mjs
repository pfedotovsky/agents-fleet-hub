import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/representative-session.json', import.meta.url), 'utf8'),
)
const port = Number(process.env.FAKE_HOST_PORT ?? 4312)
const requests = []

function json(response, status, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  })
  response.end(status === 204 ? undefined : JSON.stringify(body))
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  requests.push(`${request.method} ${url.pathname}${url.search}`)
  if (request.method === 'OPTIONS') return json(response, 204, {})
  if (url.pathname === '/health') return json(response, 200, { status: 'ok', version: 'fixture' })
  if (url.pathname === '/__state') return json(response, 200, { requests })
  if (url.pathname === '/api/auth/status') {
    return json(response, 200, { needsSetup: false, localAuthBypass: false })
  }
  if (url.pathname === '/api/projects') return json(response, 200, [fixture.project])
  if (url.pathname === '/api/providers/sessions/running') {
    return json(response, 200, { success: true, data: { sessions: [] } })
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
  if (url.pathname === '/api/providers/codex/models') {
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
    if (message.type !== 'chat.subscribe') return
    socket.send(
      JSON.stringify({
        type: 'chat_subscribed',
        sessionId: 'fixture-session',
        isProcessing: false,
        lastSeq: 0,
        pendingPermissions: [],
      }),
    )
  })
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Sanitized UX fixture host listening on ${port}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

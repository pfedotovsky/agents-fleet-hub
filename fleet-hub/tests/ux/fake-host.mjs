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
const interactionPrompt = 'Review synthetic interaction choices.'
const interactionReply = 'Synthetic interaction flow finished.'
const interruptPrompt = 'Start a synthetic task that will be interrupted.'
const resumePrompt = 'Resume the interrupted synthetic task.'
let createdSession = null
let createdMessages = []
let createdRun = { processing: false, lastSeq: 0, pendingPermissions: [], events: [] }
let fixtureSessionArchived = false
let socketConnections = 0

async function requestJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function projectState() {
  const fixtureSessions = fixtureSessionArchived ? [] : fixture.project.sessions
  return {
    ...fixture.project,
    sessions: createdSession ? [createdSession, ...fixtureSessions] : fixtureSessions,
    sessionMeta: {
      ...fixture.project.sessionMeta,
      total:
        fixture.project.sessionMeta.total -
        (fixtureSessionArchived ? 1 : 0) +
        (createdSession ? 1 : 0),
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
    createdRun = { processing: false, lastSeq: 0, pendingPermissions: [], events: [] }
    fixtureSessionArchived = false
    socketConnections = 0
    return json(response, 204, {})
  }
  if (url.pathname === '/__state') {
    return json(response, 200, {
      requests,
      socketMessages,
      createdSession,
      createdMessages,
      createdRun,
      fixtureSessionArchived,
      socketConnections,
    })
  }
  if (url.pathname === '/api/auth/status') {
    return json(response, 200, { needsSetup: false, localAuthBypass: false })
  }
  if (url.pathname === '/api/projects') return json(response, 200, [projectState()])
  if (url.pathname === '/api/providers/sessions/running') {
    return json(response, 200, { success: true, data: { sessions: [] } })
  }
  if (request.method === 'GET' && url.pathname === '/api/providers/search/sessions') {
    const query = url.searchParams.get('q')?.trim().toLowerCase() ?? ''
    response.writeHead(200, {
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream',
    })
    if (query === 'synthetic status') {
      response.write('event: result\n')
      response.write(
        `data: ${JSON.stringify({
          projectResult: {
            projectId: fixture.project.projectId,
            projectName: fixture.project.path,
            projectDisplayName: fixture.project.displayName,
            sessions: [
              {
                sessionId: fixture.project.sessions[0].id,
                provider: fixture.project.sessions[0].provider,
                sessionSummary: fixture.project.sessions[0].summary,
                matches: [
                  {
                    role: 'assistant',
                    snippet: 'The synthetic status is ready.',
                    highlights: [{ start: 4, end: 20 }],
                    timestamp: '2026-01-02T03:04:05.000Z',
                    provider: 'codex',
                  },
                ],
              },
            ],
          },
          totalMatches: 1,
          scannedProjects: 1,
          totalProjects: 1,
        })}\n\n`,
      )
    } else {
      response.write(
        `event: progress\ndata: ${JSON.stringify({
          totalMatches: 0,
          scannedProjects: 1,
          totalProjects: 1,
        })}\n\n`,
      )
    }
    response.end('event: done\n\n')
    return
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
    createdRun = { processing: false, lastSeq: 0, pendingPermissions: [], events: [] }
    return json(response, 200, {
      success: true,
      data: {
        sessionId: createdSessionId,
        provider: body.provider,
        projectPath: body.projectPath,
      },
    })
  }
  if (request.method === 'DELETE' && url.pathname === '/api/providers/sessions/fixture-session') {
    fixtureSessionArchived = true
    return json(response, 200, { success: true })
  }
  if (
    request.method === 'POST' &&
    url.pathname === '/api/providers/sessions/fixture-session/restore'
  ) {
    fixtureSessionArchived = false
    return json(response, 200, { success: true })
  }
  if (request.method === 'GET' && url.pathname === '/api/providers/sessions/archived') {
    return json(response, 200, {
      success: true,
      data: {
        sessions: fixtureSessionArchived
          ? [
              {
                sessionId: fixture.project.sessions[0].id,
                provider: fixture.project.sessions[0].provider,
                projectId: fixture.project.projectId,
                projectPath: fixture.project.fullPath,
                projectDisplayName: fixture.project.displayName,
                sessionTitle: fixture.project.sessions[0].summary,
                createdAt: '2026-01-02T03:04:00.000Z',
                updatedAt: fixture.project.sessions[0].lastActivity,
                lastActivity: fixture.project.sessions[0].lastActivity,
                isProjectArchived: false,
              },
            ]
          : [],
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
  socketConnections += 1
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    socketMessages.push(message)
    if (message.type === 'chat.subscribe') {
      const sessionId = message.sessions?.[0]?.sessionId
      const lastSeq = message.sessions?.[0]?.lastSeq ?? 0
      socket.send(
        JSON.stringify({
          kind: 'chat_subscribed',
          sessionId,
          isProcessing: sessionId === createdSessionId ? createdRun.processing : false,
          lastSeq: sessionId === createdSessionId ? createdRun.lastSeq : 0,
          pendingPermissions:
            sessionId === createdSessionId ? createdRun.pendingPermissions : [],
        }),
      )
      if (sessionId === createdSessionId) {
        for (const event of createdRun.events.filter((candidate) => candidate.seq > lastSeq)) {
          socket.send(JSON.stringify(event))
        }
      }
      return
    }
    if (message.type === 'chat.abort' && message.sessionId === createdSessionId) {
      if (!createdRun.processing) return
      createdRun.lastSeq += 1
      createdRun.processing = false
      const event = {
        kind: 'complete',
        sessionId: createdSessionId,
        seq: createdRun.lastSeq,
        exitCode: 0,
        success: false,
        aborted: true,
      }
      createdRun.events.push(event)
      socket.send(JSON.stringify(event))
      return
    }
    if (message.type === 'chat.permission-response') {
      const pending = createdRun.pendingPermissions[0]
      if (!pending || message.requestId !== pending.requestId) return

      if (pending.requestId === 'fixture-allow-edit' && message.allow === true) {
        const request = {
          requestId: 'fixture-deny-command',
          toolName: 'Bash',
          input: { command: 'fixture-check --dry-run' },
        }
        createdRun.lastSeq += 1
        createdRun.pendingPermissions = [request]
        socket.send(
          JSON.stringify({
            kind: 'permission_request',
            sessionId: createdSessionId,
            seq: createdRun.lastSeq,
            ...request,
          }),
        )
        return
      }

      if (pending.requestId === 'fixture-deny-command' && message.allow === false) {
        const request = {
          requestId: 'fixture-answer-question',
          toolName: 'AskUserQuestion',
          input: {
            questions: [
              {
                question: 'Which synthetic response style should be used?',
                header: 'Style',
                options: [
                  { label: 'Concise', description: 'Use the shorter fixture response.' },
                  { label: 'Detailed', description: 'Use the longer fixture response.' },
                ],
                multiSelect: false,
              },
            ],
          },
        }
        createdRun.lastSeq += 1
        createdRun.pendingPermissions = [request]
        socket.send(
          JSON.stringify({
            kind: 'permission_request',
            sessionId: createdSessionId,
            seq: createdRun.lastSeq,
            ...request,
          }),
        )
        return
      }

      if (
        pending.requestId === 'fixture-answer-question' &&
        message.allow === true &&
        message.updatedInput?.answers?.['Which synthetic response style should be used?'] ===
          'Concise'
      ) {
        createdRun.pendingPermissions = []
        createdMessages.push({
          id: 'fixture-interaction-assistant-1',
          sessionId: createdSessionId,
          timestamp: '2026-01-03T04:05:02.000Z',
          provider: 'codex',
          kind: 'text',
          role: 'assistant',
          content: interactionReply,
        })
        createdRun.lastSeq += 1
        socket.send(
          JSON.stringify({
            ...createdMessages[1],
            id: 'fixture-interaction-assistant-live-1',
            seq: createdRun.lastSeq,
          }),
        )
        createdRun.lastSeq += 1
        createdRun.processing = false
        socket.send(
          JSON.stringify({
            kind: 'complete',
            sessionId: createdSessionId,
            seq: createdRun.lastSeq,
            success: true,
          }),
        )
      }
      return
    }
    if (message.type !== 'chat.send' || message.sessionId !== createdSessionId) return

    const isResume = message.content === resumePrompt && createdMessages[0]?.content === interruptPrompt
    const userMessage = {
      id: isResume ? 'fixture-resume-user-2' : 'fixture-created-user-1',
      sessionId: createdSessionId,
      timestamp: isResume ? '2026-01-03T04:05:03.000Z' : '2026-01-03T04:05:01.000Z',
      provider: 'codex',
      kind: 'text',
      role: 'user',
      content: message.content,
    }
    createdMessages = isResume ? [...createdMessages, userMessage] : [userMessage]
    createdRun = { processing: true, lastSeq: 0, pendingPermissions: [], events: [] }
    socket.send(
      JSON.stringify({
        kind: 'chat_subscribed',
        sessionId: createdSessionId,
        isProcessing: true,
        lastSeq: 0,
        pendingPermissions: [],
      }),
    )
    if (message.content === interactionPrompt) {
      const request = {
        requestId: 'fixture-allow-edit',
        toolName: 'Edit',
        input: { filePath: '/safe/fixture-project/status.txt' },
      }
      createdRun.lastSeq = 1
      createdRun.pendingPermissions = [request]
      socket.send(
        JSON.stringify({
          kind: 'permission_request',
          sessionId: createdSessionId,
          seq: createdRun.lastSeq,
          ...request,
        }),
      )
      return
    }

    if (message.content === interruptPrompt) {
      const partial = {
        id: 'fixture-interrupted-assistant-live-1',
        sessionId: createdSessionId,
        timestamp: '2026-01-03T04:05:02.000Z',
        provider: 'codex',
        kind: 'text',
        role: 'assistant',
        content: 'Synthetic task reached a safe checkpoint.',
        seq: 1,
      }
      createdMessages.push({ ...partial, id: 'fixture-interrupted-assistant-1' })
      createdRun.lastSeq = 1
      createdRun.events.push(partial)
      socket.send(JSON.stringify(partial))
      return
    }

    if (isResume) {
      const reconnecting = {
        id: 'fixture-resume-assistant-live-1',
        sessionId: createdSessionId,
        timestamp: '2026-01-03T04:05:04.000Z',
        provider: 'codex',
        kind: 'text',
        role: 'assistant',
        content: 'Synthetic resume is waiting for reconnection.',
        seq: 1,
      }
      createdMessages.push({ ...reconnecting, id: 'fixture-resume-assistant-1' })
      createdRun.lastSeq = 1
      createdRun.events.push(reconnecting)
      socket.send(JSON.stringify(reconnecting))

      setTimeout(() => socket.close(), 100)
      setTimeout(() => {
        const finished = {
          id: 'fixture-resume-assistant-live-2',
          sessionId: createdSessionId,
          timestamp: '2026-01-03T04:05:05.000Z',
          provider: 'codex',
          kind: 'text',
          role: 'assistant',
          content: 'Synthetic task resumed and finished.',
          seq: 2,
        }
        createdMessages.push({ ...finished, id: 'fixture-resume-assistant-2' })
        createdRun.lastSeq = 2
        createdRun.events.push(finished)

        const complete = {
          kind: 'complete',
          sessionId: createdSessionId,
          seq: 3,
          exitCode: 0,
          success: true,
          aborted: false,
        }
        createdRun.lastSeq = 3
        createdRun.processing = false
        createdRun.events.push(complete)
      }, 150)
      return
    }

    createdMessages.push({
      id: 'fixture-created-assistant-1',
      sessionId: createdSessionId,
      timestamp: '2026-01-03T04:05:02.000Z',
      provider: 'codex',
      kind: 'text',
      role: 'assistant',
      content: 'Synthetic stream finished successfully.',
    })
    setTimeout(() => {
      if (socket.readyState !== 1) return
      createdRun.lastSeq = 1
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
      createdRun.lastSeq = 2
      createdRun.processing = false
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

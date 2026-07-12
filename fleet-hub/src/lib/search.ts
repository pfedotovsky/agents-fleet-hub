import type { Provider } from '../types'

/** One highlighted range inside a snippet, in character offsets. */
export interface SearchHighlight {
  start: number
  end: number
}

export interface SearchMatch {
  role: string
  snippet: string
  highlights: SearchHighlight[]
  timestamp: string | null
  provider: Provider
}

export interface SearchSessionResult {
  sessionId: string
  provider: Provider
  sessionSummary: string
  matches: SearchMatch[]
}

export interface SearchProjectResult {
  projectId: string | null
  projectName: string
  projectDisplayName: string
  sessions: SearchSessionResult[]
}

export interface SearchProgress {
  totalMatches: number
  scannedProjects: number
  totalProjects: number
}

interface SearchCallbacks {
  limit?: number
  signal: AbortSignal
  onResult: (result: SearchProjectResult, progress: SearchProgress) => void
  onProgress?: (progress: SearchProgress) => void
  onTokenRefresh: (token: string) => void
}

/**
 * Streams full-text conversation search from one host.
 *
 * `GET /api/providers/search/sessions` is Server-Sent Events, consumed with
 * fetch + ReadableStream because EventSource cannot send the Bearer header.
 * Resolves when the host reports `done` (or the stream ends); rejects on
 * `error` events, HTTP errors, and network failures. Aborting via `signal`
 * resolves quietly — cancelled searches are routine, not errors.
 */
export async function searchSessions(
  baseUrl: string,
  token: string,
  query: string,
  { limit = 50, signal, onResult, onProgress, onTokenRefresh }: SearchCallbacks,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(
      `${baseUrl}/api/providers/search/sessions?q=${encodeURIComponent(query)}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}` }, signal },
    )
  } catch (err) {
    if (signal.aborted) return
    throw err instanceof Error ? err : new Error(String(err))
  }

  const refreshed = res.headers.get('X-Refreshed-Token')
  if (refreshed) onTokenRefresh(refreshed)

  if (!res.ok || !res.body) {
    throw new Error(`Search failed (${res.status})`)
  }

  const decoder = new TextDecoder()
  const reader = res.body.getReader()
  let buffer = ''

  const handleFrame = (frame: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length === 0) return event === 'done' ? 'done' : undefined
    if (event === 'error') {
      const parsed = JSON.parse(dataLines.join('\n')) as { error?: string }
      throw new Error(parsed.error ?? 'Search failed')
    }
    if (event === 'result' || event === 'progress') {
      const parsed = JSON.parse(dataLines.join('\n')) as {
        projectResult?: SearchProjectResult | null
        totalMatches: number
        scannedProjects: number
        totalProjects: number
      }
      const progress = {
        totalMatches: parsed.totalMatches,
        scannedProjects: parsed.scannedProjects,
        totalProjects: parsed.totalProjects,
      }
      if (event === 'result' && parsed.projectResult) onResult(parsed.projectResult, progress)
      else onProgress?.(progress)
    }
    return event === 'done' ? 'done' : undefined
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (handleFrame(frame) === 'done') return
        boundary = buffer.indexOf('\n\n')
      }
    }
  } catch (err) {
    if (signal.aborted) return
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    reader.cancel().catch(() => {})
  }
}

import type { APIRequestContext, Page } from '@playwright/test'

export const REPLAY_HOST = {
  id: 'replay-host',
  name: 'Sanitized replay',
  baseUrl: 'http://127.0.0.1:4174',
} as const

export interface ReplayObservation {
  authorizationHeaders: string[]
  socketMessages: unknown[]
}

export interface ReplayProbe {
  read: () => Promise<ReplayObservation>
}

/**
 * Connects the Hub to the deterministic localhost replay. Every replay value
 * is synthetic; never derive this fixture from a real host, transcript, or token.
 */
export async function installReplayHost(
  page: Page,
  request: APIRequestContext,
): Promise<ReplayProbe> {
  await request.post(`${REPLAY_HOST.baseUrl}/__replay/reset`)

  await page.addInitScript((host) => {
    localStorage.setItem('fleethub.v1.hosts', JSON.stringify([host]))
  }, REPLAY_HOST)

  // Keep Vite's development-only localhost discovery deterministic and quiet.
  await page.route(/^http:\/\/localhost:(3001|3012)\/health$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'absent' }),
    }),
  )

  return {
    read: async () => {
      const response = await request.get(`${REPLAY_HOST.baseUrl}/__replay/observations`)
      return response.json() as Promise<ReplayObservation>
    },
  }
}

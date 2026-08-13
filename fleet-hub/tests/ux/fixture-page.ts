import { expect, type Page } from '@playwright/test'

export interface BrowserFailureLog {
  browserFailures: string[]
  failedResponses: string[]
}

export async function prepareFixturePage(page: Page): Promise<BrowserFailureLog> {
  const failures: BrowserFailureLog = { browserFailures: [], failedResponses: [] }
  const reset = await page.request.post('http://127.0.0.1:4312/__reset')
  expect(reset.ok()).toBeTruthy()
  page.on('console', (message) => {
    if (message.type() === 'error') failures.browserFailures.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => failures.browserFailures.push(`pageerror: ${error.message}`))
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failures.failedResponses.push(`${response.status()} ${response.url()}`)
    }
  })

  // Local-host discovery is intentionally best-effort. Stub its well-known
  // probes so the browser-error gate stays about the journey under test.
  await page.route(/^http:\/\/localhost:(3012|3001)\/health$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'not-configured' }),
    }),
  )

  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem(
      'fleethub.v1.hosts',
      JSON.stringify([
        {
          id: 'fixture-host',
          name: 'Sanitized replay host',
          baseUrl: 'http://127.0.0.1:4312',
        },
      ]),
    )
    localStorage.setItem(
      'fleethub.v1.tokens',
      JSON.stringify({ 'fixture-host': 'fixture-token' }),
    )
    localStorage.setItem(
      'fleethub.v1.autoAdded',
      JSON.stringify(['http://localhost:3012', 'http://localhost:3001']),
    )
  })

  return failures
}

export function expectNoBrowserFailures(failures: BrowserFailureLog): void {
  expect(failures).toEqual({ browserFailures: [], failedResponses: [] })
}

export async function openFixtureTranscript(page: Page): Promise<void> {
  await page.goto('/')
  const session = page.getByText('Deterministic transcript', { exact: true })
  await expect(session).toBeVisible()
  await session.click()
  await expect(page.getByText('Open the synthetic status file.', { exact: true })).toBeVisible()
}

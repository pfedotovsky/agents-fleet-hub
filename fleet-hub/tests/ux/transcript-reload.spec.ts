import { expect, test } from '@playwright/test'

test('connects to the replay host and preserves the transcript after reload', async ({ page }) => {
  const browserFailures: string[] = []
  const failedResponses: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserFailures.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserFailures.push(`pageerror: ${error.message}`))
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`)
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

  await page.goto('/')
  await expect(page.getByText('Deterministic transcript', { exact: true })).toBeVisible()
  await page.getByText('Deterministic transcript', { exact: true }).click()

  const userPrompt = page.getByText('Open the synthetic status file.', { exact: true })
  const assistantReply = page.getByText('The synthetic status is ready.', { exact: true })
  await expect(userPrompt).toHaveCount(1)
  await expect(userPrompt).toBeVisible()
  await expect(assistantReply).toBeVisible()

  const stateBeforeReload = await page.request.get('http://127.0.0.1:4312/__state')
  const requestsBeforeReload = ((await stateBeforeReload.json()) as { requests: string[] }).requests
  const historyLoadsBeforeReload = requestsBeforeReload.filter((entry) =>
    entry.startsWith('GET /api/providers/sessions/fixture-session/messages'),
  ).length

  await page.reload()
  await expect(userPrompt).toHaveCount(1)
  await expect(userPrompt).toBeVisible()
  await expect(assistantReply).toBeVisible()
  await expect(page.getByText('You', { exact: true })).toHaveCount(1)

  const state = await page.request.get('http://127.0.0.1:4312/__state')
  expect(state.ok()).toBeTruthy()
  const { requests } = (await state.json()) as { requests: string[] }
  const historyLoadsAfterReload = requests.filter((entry) =>
    entry.startsWith('GET /api/providers/sessions/fixture-session/messages'),
  ).length
  expect(historyLoadsBeforeReload).toBeGreaterThan(0)
  expect(historyLoadsAfterReload).toBeGreaterThan(historyLoadsBeforeReload)
  expect({ browserFailures, failedResponses }).toEqual({ browserFailures: [], failedResponses: [] })
})

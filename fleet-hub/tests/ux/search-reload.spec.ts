import { expect, test } from '@playwright/test'
import { expectNoBrowserFailures, prepareFixturePage } from './fixture-page'

const query = 'synthetic status'
const userPrompt = 'Open the synthetic status file.'
const assistantReply = 'The synthetic status is ready.'

test('searches, opens, and reloads a sanitized transcript', async ({ page }) => {
  const failures = await prepareFixturePage(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Search conversations (⌘K)' }).click()
  const searchInput = page.getByPlaceholder('Search conversations across all hosts…')
  await expect(searchInput).toBeFocused()
  await searchInput.fill(query)

  const result = page.getByRole('button', { name: /Deterministic transcript/ })
  await expect(result).toBeVisible()
  await expect(page.getByText('1 match', { exact: true })).toBeVisible()
  await expect(result.locator('mark')).toHaveText(query)

  await searchInput.press('Enter')
  await expect(page).toHaveURL(/#\/s\/fixture-host\/fixture-project\/fixture-session$/)
  await expect(page.getByText(userPrompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(assistantReply, { exact: true })).toHaveCount(1)

  const readRequests = async (): Promise<string[]> => {
    const response = await page.request.get('http://127.0.0.1:4312/__state')
    expect(response.ok()).toBeTruthy()
    return ((await response.json()) as { requests: string[] }).requests
  }
  const requestsBeforeReload = await readRequests()
  expect(requestsBeforeReload).toContain(
    'GET /api/providers/search/sessions?q=synthetic%20status&limit=50',
  )
  const historyLoadsBeforeReload = requestsBeforeReload.filter((entry) =>
    entry.startsWith('GET /api/providers/sessions/fixture-session/messages'),
  ).length

  await page.reload()
  await expect(page.getByText(userPrompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(assistantReply, { exact: true })).toHaveCount(1)
  await expect(page.getByText('You', { exact: true })).toHaveCount(1)

  await expect
    .poll(async () => {
      const requests = await readRequests()
      return requests.filter((entry) =>
        entry.startsWith('GET /api/providers/sessions/fixture-session/messages'),
      ).length
    })
    .toBeGreaterThan(historyLoadsBeforeReload)
  expectNoBrowserFailures(failures)
})

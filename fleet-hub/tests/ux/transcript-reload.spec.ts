import { expect, test } from '@playwright/test'
import {
  expectNoBrowserFailures,
  openFixtureTranscript,
  prepareFixturePage,
} from './fixture-page'

test('connects to the replay host and preserves the transcript after reload', async ({ page }) => {
  const failures = await prepareFixturePage(page)
  await openFixtureTranscript(page)

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
  expectNoBrowserFailures(failures)
})

import { expect, test } from '@playwright/test'
import { expectNoBrowserFailures, prepareFixturePage } from './fixture-page'

const sessionTitle = 'Deterministic transcript'
const userPrompt = 'Open the synthetic status file.'
const assistantReply = 'The synthetic status is ready.'

test('archives, reloads, and restores a sanitized session with its transcript intact', async ({
  page,
}) => {
  const failures = await prepareFixturePage(page)
  await page.goto('/')

  const main = page.locator('main')
  await expect(main.getByText(sessionTitle, { exact: true })).toBeVisible()
  await main.getByText(sessionTitle, { exact: true }).hover()
  await main.getByTitle('Archive (restorable)').click()
  await expect(page.getByText(sessionTitle, { exact: true })).toHaveCount(0)

  await page.reload()
  await expect(page.getByText(sessionTitle, { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /Archived chats/ }).click()
  const archivedSession = page.getByText(sessionTitle, { exact: true })
  await expect(archivedSession).toBeVisible()

  const archivedState = await page.request.get('http://127.0.0.1:4312/__state')
  expect(archivedState.ok()).toBeTruthy()
  expect(
    (await archivedState.json()) as {
      fixtureSessionArchived: boolean
      requests: string[]
    },
  ).toMatchObject({
    fixtureSessionArchived: true,
    requests: expect.arrayContaining([
      'DELETE /api/providers/sessions/fixture-session',
      'GET /api/providers/sessions/archived',
    ]),
  })

  await archivedSession.hover()
  await page.getByTitle('Restore').click()
  await expect(page.getByText(sessionTitle, { exact: true })).toBeVisible()

  const restoredState = await page.request.get('http://127.0.0.1:4312/__state')
  expect(restoredState.ok()).toBeTruthy()
  expect(
    (await restoredState.json()) as {
      fixtureSessionArchived: boolean
      requests: string[]
    },
  ).toMatchObject({
    fixtureSessionArchived: false,
    requests: expect.arrayContaining([
      'POST /api/providers/sessions/fixture-session/restore',
      'GET /api/projects?sessionsLimit=5',
    ]),
  })

  await page.getByText(sessionTitle, { exact: true }).first().click()
  await expect(page.getByText(userPrompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(assistantReply, { exact: true })).toHaveCount(1)

  await page.reload()
  await expect(page.getByText(userPrompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(assistantReply, { exact: true })).toHaveCount(1)
  expectNoBrowserFailures(failures)
})

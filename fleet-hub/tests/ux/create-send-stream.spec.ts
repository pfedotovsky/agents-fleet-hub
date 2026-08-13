import { expect, test } from '@playwright/test'
import { expectNoBrowserFailures, prepareFixturePage } from './fixture-page'

const createdSessionId = 'fixture-created-session'
const prompt = 'Create a synthetic status note.'
const reply = 'Synthetic stream finished successfully.'

interface FixtureState {
  requests: string[]
  socketMessages: Array<{
    type?: string
    sessionId?: string
    content?: string
    options?: { permissionMode?: string }
  }>
}

test('creates, sends, streams, reconciles, and reloads a sanitized session', async ({ page }) => {
  const failures = await prepareFixturePage(page)
  await page.goto('/')

  await page.locator('button[title="/safe/fixture-project"]').click()
  await expect(page.getByRole('heading', { name: 'Fixture project' })).toBeVisible()
  await page.getByRole('button', { name: 'New session', exact: true }).click()
  await page.getByTitle('Start this chat with Codex').click()

  const composer = page.getByPlaceholder('Message Codex in Fixture project…')
  await expect(composer).toBeEnabled()
  await composer.fill(prompt)
  await page.getByTitle('Send (Enter)').click()

  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1)
  await expect(page.getByTitle('Stop the agent')).toBeVisible()
  await expect(page.getByText(reply, { exact: true })).toBeVisible()
  await expect(page.getByTitle('Stop the agent')).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`#/s/fixture-host/fixture-project/${createdSessionId}$`))

  const readState = async (): Promise<FixtureState> => {
    const response = await page.request.get('http://127.0.0.1:4312/__state')
    expect(response.ok()).toBeTruthy()
    return (await response.json()) as FixtureState
  }

  await expect
    .poll(async () => {
      const state = await readState()
      return state.requests.filter((entry) =>
        entry.startsWith(`GET /api/providers/sessions/${createdSessionId}/messages`),
      ).length
    })
    .toBeGreaterThan(0)

  const stateBeforeReload = await readState()
  expect(stateBeforeReload.requests).toContain('POST /api/providers/sessions')
  expect(stateBeforeReload.socketMessages).toContainEqual(
    expect.objectContaining({
      type: 'chat.send',
      sessionId: createdSessionId,
      content: prompt,
      options: expect.objectContaining({ permissionMode: 'default' }),
    }),
  )
  const historyLoadsBeforeReload = stateBeforeReload.requests.filter((entry) =>
    entry.startsWith(`GET /api/providers/sessions/${createdSessionId}/messages`),
  ).length

  await page.reload()
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(reply, { exact: true })).toHaveCount(1)
  await expect(page.getByText('You', { exact: true })).toHaveCount(1)

  await expect
    .poll(async () => {
      const state = await readState()
      return state.requests.filter((entry) =>
        entry.startsWith(`GET /api/providers/sessions/${createdSessionId}/messages`),
      ).length
    })
    .toBeGreaterThan(historyLoadsBeforeReload)
  expectNoBrowserFailures(failures)
})

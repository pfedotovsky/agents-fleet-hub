import { expect, test } from '@playwright/test'
import { expectNoBrowserFailures, prepareFixturePage } from './fixture-page'

const createdSessionId = 'fixture-created-session'
const prompt = 'Review synthetic interaction choices.'
const reply = 'Synthetic interaction flow finished.'
const question = 'Which synthetic response style should be used?'

interface FixtureState {
  requests: string[]
  socketMessages: Array<{
    type?: string
    requestId?: string
    allow?: boolean
    updatedInput?: {
      answers?: Record<string, string>
    }
  }>
}

test('allows, reloads a pending denial, and answers a sanitized question', async ({ page }) => {
  const failures = await prepareFixturePage(page)
  await page.goto('/')

  await page.locator('button[title="/safe/fixture-project"]').click()
  await page.getByRole('button', { name: 'New session', exact: true }).click()
  await page.getByTitle('Start this chat with Codex').click()

  const composer = page.getByPlaceholder('Message Codex in Fixture project…')
  await composer.fill(prompt)
  await page.getByTitle('Send (Enter)').click()

  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText('Permission requested:')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Always allow Edit' })).toBeVisible()
  await expect(page.getByText('/safe/fixture-project/status.txt', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Allow', exact: true }).click()

  await expect(page.getByRole('button', { name: 'Always allow Bash' })).toBeVisible()
  await expect(page.getByText('fixture-check --dry-run', { exact: false })).toBeVisible()

  const readState = async (): Promise<FixtureState> => {
    const response = await page.request.get('http://127.0.0.1:4312/__state')
    expect(response.ok()).toBeTruthy()
    return (await response.json()) as FixtureState
  }

  await page.reload()
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Always allow Bash' })).toBeVisible()
  await expect(page.getByText('fixture-check --dry-run', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Deny', exact: true }).click()

  await expect(page.getByText('The agent has a question', { exact: true })).toBeVisible()
  await expect(page.getByText(question, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Concise/ }).click()

  await expect(page.getByText(reply, { exact: true })).toBeVisible()
  await expect(page.getByTitle('Stop the agent')).toBeHidden()

  await expect
    .poll(async () => {
      const state = await readState()
      return state.socketMessages.filter((message) => message.type === 'chat.permission-response')
    })
    .toMatchObject([
      { requestId: 'fixture-allow-edit', allow: true },
      { requestId: 'fixture-deny-command', allow: false },
      {
        requestId: 'fixture-answer-question',
        allow: true,
        updatedInput: { answers: { [question]: 'Concise' } },
      },
    ])

  const stateBeforeReload = await readState()
  const historyLoadsBeforeReload = stateBeforeReload.requests.filter((entry) =>
    entry.startsWith(`GET /api/providers/sessions/${createdSessionId}/messages`),
  ).length

  await page.reload()
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(reply, { exact: true })).toHaveCount(1)
  await expect(page.getByText('You', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Permission requested:')).toBeHidden()
  await expect(page.getByText('The agent has a question', { exact: true })).toBeHidden()

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

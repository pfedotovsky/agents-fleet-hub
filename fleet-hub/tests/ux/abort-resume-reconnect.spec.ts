import { expect, test } from '@playwright/test'
import { expectNoBrowserFailures, prepareFixturePage } from './fixture-page'

const createdSessionId = 'fixture-created-session'
const interruptPrompt = 'Start a synthetic task that will be interrupted.'
const resumePrompt = 'Resume the interrupted synthetic task.'
const interruptedReply = 'Synthetic task reached a safe checkpoint.'
const reconnectingReply = 'Synthetic resume is waiting for reconnection.'
const finishedReply = 'Synthetic task resumed and finished.'

interface FixtureState {
  socketConnections: number
  socketMessages: Array<{
    type?: string
    sessionId?: string
    sessions?: Array<{ sessionId?: string; lastSeq?: number }>
  }>
}

test('aborts, resumes, reconnects, reconciles, and reloads a sanitized run', async ({ page }) => {
  const failures = await prepareFixturePage(page)
  await page.goto('/')

  await page.locator('button[title="/safe/fixture-project"]').click()
  await page.getByRole('button', { name: 'New session', exact: true }).click()
  await page.getByTitle('Start this chat with Codex').click()

  const composer = page.getByPlaceholder('Message Codex in Fixture project…')
  await composer.fill(interruptPrompt)
  await page.getByTitle('Send (Enter)').click()

  await expect(page.getByText(interruptPrompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(interruptedReply, { exact: true })).toHaveCount(1)
  await page.getByTitle('Stop the agent').click()
  await expect(page.getByTitle('Stop the agent')).toBeHidden()

  const readState = async (): Promise<FixtureState> => {
    const response = await page.request.get('http://127.0.0.1:4312/__state')
    expect(response.ok()).toBeTruthy()
    return (await response.json()) as FixtureState
  }
  const connectionsBeforeResume = (await readState()).socketConnections

  await composer.fill(resumePrompt)
  await page.getByTitle('Send (Enter)').click()
  await expect(page.getByText(resumePrompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(reconnectingReply, { exact: true })).toHaveCount(1)
  await expect(page.getByPlaceholder('Connecting to host…')).toBeDisabled()

  await expect(page.getByText(finishedReply, { exact: true })).toHaveCount(1)
  await expect(page.getByTitle('Stop the agent')).toBeHidden()

  await expect.poll(async () => (await readState()).socketConnections).toBeGreaterThan(
    connectionsBeforeResume,
  )
  const stateAfterReconnect = await readState()
  expect(
    stateAfterReconnect.socketMessages.filter(
      (message) => message.type === 'chat.abort' && message.sessionId === createdSessionId,
    ),
  ).toHaveLength(1)
  expect(
    stateAfterReconnect.socketMessages.filter(
      (message) =>
        message.type === 'chat.subscribe' &&
        message.sessions?.[0]?.sessionId === createdSessionId &&
        message.sessions[0].lastSeq === 1,
    ),
  ).toHaveLength(1)

  const stateBeforeReload = await readState()
  const socketMessagesBeforeReload = stateBeforeReload.socketMessages.length
  await page.reload()

  await expect(page.getByText(interruptPrompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(interruptedReply, { exact: true })).toHaveCount(1)
  await expect(page.getByText(resumePrompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(reconnectingReply, { exact: true })).toHaveCount(1)
  await expect(page.getByText(finishedReply, { exact: true })).toHaveCount(1)
  await expect(page.getByText('You', { exact: true })).toHaveCount(2)
  await expect
    .poll(async () => (await readState()).socketMessages.length)
    .toBeGreaterThan(socketMessagesBeforeReload)
  expectNoBrowserFailures(failures)
})

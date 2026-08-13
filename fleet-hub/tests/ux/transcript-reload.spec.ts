import { expect, test } from '@playwright/test'
import { installReplayHost } from './replayHost'

test('mints local auth and preserves a transcript through reload', async ({ page, request }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  const replay = await installReplayHost(page, request)
  await page.goto('/')

  const session = page
    .getByRole('button')
    .filter({ hasText: 'Replay transcript fidelity' })
    .first()
  await expect(session).toBeVisible()
  await session.focus()
  await expect(session).toBeFocused()
  await session.press('Enter')

  await expect(page.getByText('Check the deterministic replay.', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Replay response is stable.', { exact: true })).toHaveCount(1)
  await expect
    .poll(async () =>
      (await replay.read()).socketMessages.some(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'chat.subscribe',
      ),
    )
    .toBe(true)

  await page.reload()

  await expect(page.getByText('Check the deterministic replay.', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Replay response is stable.', { exact: true })).toHaveCount(1)
  expect((await replay.read()).authorizationHeaders).toContain(
    'Bearer fixture-token-not-a-secret',
  )
  expect(browserErrors).toEqual([])
})

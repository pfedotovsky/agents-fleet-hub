import { expect, test } from '@playwright/test'
import {
  expectNoBrowserFailures,
  openFixtureTranscript,
  prepareFixturePage,
} from './fixture-page'

test('keeps keyboard focus, accessible names, contrast, and reduced motion deterministic', async ({
  page,
}) => {
  const failures = await prepareFixturePage(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  const searchButton = page.getByRole('button', { name: 'Search conversations (⌘K)' })
  await expect(searchButton).toBeVisible()
  await searchButton.focus()
  await expect(searchButton).toBeFocused()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Search conversations' })
  const searchInput = page.getByPlaceholder('Search conversations across all hosts…')
  await expect(dialog).toBeVisible()
  await expect(searchInput).toBeFocused()
  await expect(dialog).toHaveCSS('transform', 'none')
  await expect(dialog).toHaveScreenshot('search-dialog.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02,
  })

  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  )
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await openFixtureTranscript(page)
  const userPrompt = page.getByText('Open the synthetic status file.', { exact: true })
  const contrastRatio = await userPrompt.evaluate((element) => {
    const channels = (color: string): [number, number, number, number] => {
      const values = color.match(/[\d.]+/g)?.map(Number) ?? []
      return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1]
    }
    const luminance = ([red, green, blue]: [number, number, number, number]) => {
      const linear = [red, green, blue].map((value) => {
        const channel = value / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }

    const foreground = channels(getComputedStyle(element).color)
    let backgroundElement: Element | null = element
    let background: [number, number, number, number] = [255, 255, 255, 1]
    while (backgroundElement) {
      const candidate = channels(getComputedStyle(backgroundElement).backgroundColor)
      if (candidate[3] >= 1) {
        background = candidate
        break
      }
      backgroundElement = backgroundElement.parentElement
    }
    const lighter = Math.max(luminance(foreground), luminance(background))
    const darker = Math.min(luminance(foreground), luminance(background))
    return (lighter + 0.05) / (darker + 0.05)
  })
  expect(contrastRatio).toBeGreaterThanOrEqual(4.5)
  expectNoBrowserFailures(failures)
})

test('keeps the structured transcript usable at a narrow desktop width', async ({ page }) => {
  const failures = await prepareFixturePage(page)
  await page.setViewportSize({ width: 820, height: 900 })
  await openFixtureTranscript(page)

  await expect(page.getByText('The synthetic status is ready.', { exact: true })).toBeVisible()
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mainWidth: document.querySelector('main')?.getBoundingClientRect().width ?? 0,
  }))
  expect(layout.scrollWidth).toBe(layout.clientWidth)
  expect(layout.mainWidth).toBeGreaterThan(400)
  expectNoBrowserFailures(failures)
})

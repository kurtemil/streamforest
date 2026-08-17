import { test, expect, collectConsoleErrors } from './fixtures'

// Baseline shape of the app in WebKit. These are the assertions that should stay
// true through the whole rebuild — if one of them breaks, something regressed
// rather than improved.

test('home renders without console errors', async ({ seededPage: page }) => {
  const errors = collectConsoleErrors(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(errors).toEqual([])
})

test('the page never scrolls sideways', async ({ seededPage: page }) => {
  await page.goto('/')
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
})

test('navigation matches the viewport', async ({ seededPage: page }, testInfo) => {
  await page.goto('/')
  const isPhone = testInfo.project.name === 'iphone-webkit'
  const bottomNav = page.getByRole('navigation', { name: 'Primary' })
  const sidebar = page.locator('aside')

  if (isPhone) {
    await expect(bottomNav).toBeVisible()
    await expect(sidebar).toBeHidden()
  } else {
    await expect(sidebar).toBeVisible()
    await expect(bottomNav).toBeHidden()
  }
})

test('the seeded library renders its rows', async ({ libraryPage: page }) => {
  await expect(page.getByRole('heading', { name: 'Continue Watching' })).toBeVisible()
  // The same title legitimately appears in several rows — Continue Watching,
  // Recently Added and its genre row — so assert presence, not a count.
  await expect(page.getByText('Arrival').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recently Added Movies' })).toBeVisible()
})

test('the profile picker is bypassed once a profile is stored', async ({ seededPage: page }) => {
  await page.goto('/')
  await expect(page.getByText("Who's watching?")).toBeHidden()
})

test('an unseeded visit is stopped by the profile picker', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText("Who's watching?")).toBeVisible()
})

import { test, expect, collectConsoleErrors, PAGING_COUNT, RECENT_TITLE } from './fixtures'

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
  // The same title legitimately appears in several rows — Continue Watching and
  // its genre row — so assert presence, not a count.
  await expect(page.getByText('Arrival').first()).toBeVisible()

  // And no Recently Added row, which is the point rather than an omission. This
  // library arrived in one import, so nothing in it is an arrival; the row used
  // to be here because it ranked by position in the playlist file and therefore
  // always had twenty titles to show, whether or not any were new.
  await expect(page.getByRole('heading', { name: 'Recently Added Movies' })).toBeHidden()
})

test('recently added shows what a later import brought, and only that', async ({ recentPage: page }) => {
  await expect(page.getByRole('heading', { name: 'Recently Added Movies' })).toBeVisible()

  const row = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recently Added Movies' }) })
  await expect(row.getByText(RECENT_TITLE, { exact: true })).toBeVisible()
  // The baseline import's titles are not arrivals and must not appear here, even
  // though they are on the page in other rows.
  await expect(row.getByText('Arrival', { exact: true })).toBeHidden()
  await expect(row.getByText('Sicario', { exact: true })).toBeHidden()
})

test('the profile picker is bypassed once a profile is stored', async ({ seededPage: page }) => {
  await page.goto('/')
  await expect(page.getByText("Who's watching?")).toBeHidden()
})

test('an unseeded visit is stopped by the profile picker', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText("Who's watching?")).toBeVisible()
})

test('the tab bar reaches the bottom of the viewport', async ({ libraryPage: page }) => {
  const nav = page.locator('nav[aria-label="Primary"]')
  // The bar is md:hidden, and an iPad is a touch device wide enough to get the
  // sidebar instead — so gate on whether it is actually rendered, not on isMobile.
  test.skip(!(await nav.isVisible()), 'No tab bar at this width')

  const box = (await nav.boundingBox())!
  const viewportHeight = page.viewportSize()!.height

  // It sat well above the bottom edge on a real iPhone while looking correct in
  // every emulated viewport — a fixed element carrying a backdrop-filter drifts
  // on iOS unless it is promoted to its own compositing layer. This asserts the
  // geometry that a screenshot from the device disagreed with, so a future change
  // to the bar's positioning cannot quietly reintroduce it.
  //
  // Note the honest limit: Playwright does not emulate safe-area insets, so this
  // catches a bar that is mispositioned by layout, not one lifted by env().
  expect(Math.round(box.y + box.height)).toBe(viewportHeight)
})

test('a filtered grid keeps loading past its first page', async ({ pagedPage: page }) => {
  // Arriving at the grid matters. Landing on /movies?group=… mounts the grid on
  // the first render and pages fine; the broken path is the one a person takes —
  // open Movies, then search — because that switches an already-mounted page from
  // rows to a grid. The sentinel appears only then, after the observer's effect
  // has already looked for it, found null, and run out of dependencies that could
  // ever tell it otherwise. Every list ended at 60 titles with nothing logged.
  await page.goto('/movies')
  await page.getByPlaceholder('Search movies…').first().fill('Paged Movie')

  const note = page.getByText(/^Showing /)
  await expect(note).toHaveText(`Showing 60 of ${PAGING_COUNT}`)

  const main = page.locator('main')
  for (let i = 0; i < 8 && (await note.isVisible()); i++) {
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await page.waitForTimeout(150)
  }

  // Note gone means count passed the total: the whole group is rendered, and the
  // last card of 130 is real rather than a number in a footer.
  await expect(note).toBeHidden()
  await expect(page.getByText(`Paged Movie ${PAGING_COUNT}`, { exact: true })).toBeVisible()
})

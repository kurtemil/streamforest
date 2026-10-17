import { test, expect, seedLibrary, stayOffline as offline } from './fixtures'

// A title opens its sheet before anything plays (feedback box, 2026-10-15):
// search, Continue Watching and the home library used to start the film on the
// first tap, with no way to look at it first or to start it over.
//
// Nothing here may leave the machine. Run on the home network these tests browse
// at the home IP, and the IPTV provider has blocked that address twice for
// traffic that looked automated (CLAUDE.md, "Never let the home IP look like a
// scraper"). So everything that is not the dev server is refused, and the home
// server is answered by a stand-in below rather than reached.

test('a film in Continue Watching opens its sheet, which offers to resume or start over', async ({ page }) => {
  await offline(page)
  await seedLibrary(page)

  const row = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Continue Watching' }) })
  await row.getByRole('button', { name: /Arrival/ }).first().click()

  const sheet = page.getByRole('dialog', { name: 'Arrival' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Resume' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Start over' })).toBeVisible()
  // Half of a two-hour film is seeded as watched.
  await expect(sheet.getByText('1h left')).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
})

test('a film found by search opens its sheet instead of playing', async ({ page }) => {
  await offline(page)
  await seedLibrary(page)

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Search movies, shows, channels…').fill('Sicario')
  await page.keyboard.press('Enter')

  const sheet = page.getByRole('dialog', { name: 'Sicario' })
  await expect(sheet).toBeVisible()
  // Never started, so the sheet says Play and has nothing to start over.
  await expect(sheet.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Start over' })).toHaveCount(0)
  await expect(page.locator('video')).toHaveCount(0)
})

test('a show in Continue Watching opens its overview, not the episode', async ({ page }) => {
  await offline(page)
  await seedLibrary(page)

  const row = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Continue Watching' }) })
  await row.getByRole('button', { name: /Severance/ }).first().click()

  await expect(page).toHaveURL(/\/series\?show=severance$/)
  await expect(page.locator('video')).toHaveCount(0)

  // The Series page's own row did play the episode, after Home's had stopped.
  await page.goto('/series')
  const seriesRow = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Continue Watching' }) })
  await seriesRow.getByRole('button', { name: /Severance/ }).first().click()
  await expect(page).toHaveURL(/\/series\?show=severance$/)
  await expect(page.locator('video')).toHaveCount(0)
})

test('a home-library film opens its sheet, with what Jellyfin knows about it', async ({ seededPage: page }) => {
  let played = false
  const marks: string[] = []
  await offline(page, async (route, url) => {
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    const path = url.pathname
    if (path === '/System/Info/Public') return json({ Version: '12.2.0' })
    if (path === '/Users/AuthenticateByName') return json({ AccessToken: 'tok', User: { Id: 'u1' } })
    if (path === '/UserViews') return json({ Items: [{ Id: 'lib', Name: 'Filmer', CollectionType: 'movies' }] })
    if (path === '/Items') {
      return json({ Items: [{
        Id: 'm1', Name: 'Troja', Type: 'Movie', ProductionYear: 2004, RunTimeTicks: 98_000_000_000,
        Overview: 'Paris rövar bort Helena.', Genres: ['Action', 'Drama'], CommunityRating: 6.9, OfficialRating: 'SE-15',
        UserData: played
          ? { PlaybackPositionTicks: 0, Played: true }
          : { PlaybackPositionTicks: 30_000_000_000, Played: false, LastPlayedDate: '2026-10-10T20:00:00Z' },
      }] })
    }
    if (path === '/Items/m1') {
      return json({ People: [
        { Id: 'p1', Name: 'Wolfgang Petersen', Type: 'Director' },
        { Id: 'p2', Name: 'Brad Pitt', Role: 'Achilles', Type: 'Actor' },
      ] })
    }
    if (path === '/UserPlayedItems/m1') {
      marks.push(route.request().method())
      played = route.request().method() === 'POST'
      return route.fulfill({ status: 200, body: '' })
    }
    return route.abort()
  })

  await page.goto('/hemma')
  await page.getByRole('button', { name: /Troja/ }).first().click()

  const sheet = page.getByRole('dialog', { name: 'Troja' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('SE-15')).toBeVisible()
  await expect(sheet.getByText('Paris rövar bort Helena.')).toBeVisible()
  await expect(sheet.getByText('Brad Pitt')).toBeVisible()
  await expect(sheet.getByText('Wolfgang Petersen')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Resume' })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)

  await sheet.getByRole('button', { name: 'Mark as watched' }).click()
  await expect(sheet.getByRole('button', { name: 'Mark as unwatched' })).toBeVisible()
  // Watched means finished: nothing left to resume.
  await expect(sheet.getByRole('button', { name: 'Resume' })).toHaveCount(0)
  expect(marks).toEqual(['POST'])

  await sheet.getByRole('button', { name: 'Mark as unwatched' }).click()
  await expect(sheet.getByRole('button', { name: 'Mark as watched' })).toBeVisible()
  expect(marks).toEqual(['POST', 'DELETE'])
})

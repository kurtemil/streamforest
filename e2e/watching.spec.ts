import { test, expect, seedLibrary, stayOffline } from './fixtures'

// What a profile has seen shows on the cards, and the home player plays a film
// that is split in files, with its subtitles (feedback box, 2026-10-15).

test('a film marked watched carries a check on its card everywhere', async ({ page }) => {
  await stayOffline(page)
  await seedLibrary(page)
  await page.goto('/movies?group=' + encodeURIComponent('VOD: Thriller'))

  const card = page.getByRole('button', { name: /Sicario/ }).first()
  await expect(card.getByRole('img', { name: 'Watched' })).toHaveCount(0)
  await card.click()
  await page.getByRole('dialog', { name: 'Sicario' }).getByRole('button', { name: 'Mark as watched' }).click()
  await page.keyboard.press('Escape')

  await expect(card.getByRole('img', { name: 'Watched' })).toBeVisible()
})

test('a split home film continues in its second file, with its subtitles to choose', async ({ seededPage: page }) => {
  const asked: string[] = []
  await stayOffline(page, async (route, url) => {
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    const path = url.pathname
    if (path === '/System/Info/Public') return json({})
    if (path === '/Users/AuthenticateByName') return json({ AccessToken: 'tok', User: { Id: 'u1' } })
    if (path === '/UserViews') return json({ Items: [{ Id: 'lib', Name: 'Filmer', CollectionType: 'movies' }] })
    if (path === '/Items') {
      return json({ Items: [{
        Id: 'p1', Name: 'Matrix', Type: 'Movie', PartCount: 2, ProductionYear: 1999, RunTimeTicks: 36_000_000_000,
        UserData: { Played: true, PlaybackPositionTicks: 0 },
      }] })
    }
    if (path === '/Videos/p1/AdditionalParts') {
      return json({ Items: [{ Id: 'p2', Name: 'Matrix', Type: 'Movie', RunTimeTicks: 32_400_000_000, UserData: { Played: false, PlaybackPositionTicks: 6_000_000_000 } }] })
    }
    if (path.endsWith('/PlaybackInfo')) {
      asked.push(path)
      return json({ PlaySessionId: 'ps', MediaSources: [{ Id: 'p2', Container: 'mp4', MediaStreams: [
        { Type: 'Subtitle', Index: 2, Language: 'swe', IsTextSubtitleStream: true, DeliveryMethod: 'External', DeliveryUrl: '/Videos/p2/p2/Subtitles/2/0/Stream.vtt?ApiKey=tok' },
      ] }] })
    }
    if (path.startsWith('/Items/p1')) return json({ People: [] })
    return route.abort()
  })

  await page.goto('/hemma')
  await page.getByRole('button', { name: /Matrix/ }).first().click()
  const sheet = page.getByRole('dialog', { name: 'Matrix' })
  // Part one (60 min) is seen and part two is 10 minutes in: 1 h 50 of 1 h 50 + 54 min.
  await expect(sheet.getByRole('button', { name: 'Resume' })).toBeVisible()
  await expect(sheet.getByText('44m left')).toBeVisible()
  await sheet.getByRole('button', { name: 'Resume' }).click()

  await expect(page.getByText('part 2 of 2')).toBeVisible()
  expect(asked.every((p) => p === '/Items/p2/PlaybackInfo')).toBe(true)
  await expect(page.locator('video track[srclang="swe"]')).toHaveCount(1)

  await page.getByRole('button', { name: 'Subtitles' }).click()
  await page.getByRole('menuitemradio', { name: 'Swedish' }).click()
  await expect.poll(() => page.evaluate(() => document.querySelector('video')!.textTracks[0]?.mode)).toBe('showing')
})

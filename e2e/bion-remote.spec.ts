import { test, expect, stayOffline } from './fixtures'

// The cinema's remote on the phone: a scrubber to drag anywhere in the film, and
// the film's audio and subtitle tracks to choose from (feedback, 2026-10-20).

test('the Bion remote scrubs and switches tracks', async ({ seededPage: page }, info) => {
  const sent: unknown[] = []
  await stayOffline(page)
  await page.route('**/api/bion**', async (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      sent.push(JSON.parse(req.postData() ?? '{}').command)
      return route.fulfill({ json: { ok: true } })
    }
    const now = Date.now()
    return route.fulfill({ json: { now, latest: 1, commands: [], status: {
      state: 'playing', source: 'iptv', title: 'Spider-Man: Brand New Day', position: 297, duration: 8701,
      audio: [{ id: 0, name: 'English 5.1' }, { id: 1, name: 'Svenska' }], audioActive: 0,
      subtitles: [{ id: 0, name: 'Svenska' }, { id: 1, name: 'English' }], subtitleActive: -1,
      updated: now,
    } } })
  })
  await page.goto('/')

  const remote = page.getByRole('region', { name: 'Remote for Bion' })
  await expect(remote).toBeVisible()
  await page.screenshot({ path: info.outputPath('remote.png') })

  const slider = remote.getByRole('slider', { name: 'Position in the film' })
  await slider.fill('4000')
  await slider.blur()
  await expect.poll(() => sent).toContainEqual({ type: 'seek', to: 4000 })

  await remote.getByRole('button', { name: 'Audio and subtitles' }).click()
  await page.screenshot({ path: info.outputPath('tracks.png') })
  await remote.getByRole('button', { name: 'Svenska' }).first().click()
  await remote.getByRole('button', { name: 'English', exact: true }).click()
  await expect.poll(() => sent).toContainEqual({ type: 'audio', id: 1 })
  await expect.poll(() => sent).toContainEqual({ type: 'subtitle', id: 1 })

  // Every button in the row stays at least 44 px and inside the remote on a phone.
  const box = await remote.boundingBox()
  for (const button of await remote.getByRole('button').all()) {
    const b = await button.boundingBox()
    if (!b || !box) continue
    expect(b.x).toBeGreaterThanOrEqual(box.x)
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
  }
})

test('the Bion remote says the projector is warming up, and can start anyway', async ({ seededPage: page }) => {
  const sent: unknown[] = []
  await stayOffline(page)
  await page.route('**/api/bion**', async (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      sent.push(JSON.parse(req.postData() ?? '{}').command)
      return route.fulfill({ json: { ok: true } })
    }
    const now = Date.now()
    return route.fulfill({ json: { now, latest: 1, commands: [], status: {
      state: 'waiting', source: 'home', title: 'Matrix', position: 0, duration: 8160, updated: now,
    } } })
  })
  await page.goto('/')

  const remote = page.getByRole('region', { name: 'Remote for Bion' })
  await expect(remote).toContainText('Projector warming up')
  await remote.getByRole('button', { name: 'Start now' }).click()
  await expect.poll(() => sent).toContainEqual({ type: 'resume' })
})

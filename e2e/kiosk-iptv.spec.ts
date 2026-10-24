import { test, expect, stayOffline } from './fixtures'

// A Play carries the IPTV film itself, without the account in its address, and the
// kiosk fills that in from its own playlist address. The living room TV used to look
// the id up in its own copy of the catalogue, 205 803 titles that took it minutes to
// write, and wrote it again for every film newer than its copy (2026-10-23).

const M3U = 'http://iptv.krutofv.se/get.php?username=user1&password=pw1&type=m3u_plus'
const PROXY = 'http://localhost:8787'

const ep = (n: number) => ({
  id: `s_${n}`, name: `Gabby S01E0${n}`, url: `http://iptv.krutofv.se/series/~/~/${n}.mkv`,
  type: 'series', groupTitle: 'Kids', showName: "Gabby's Dollhouse", season: 1, episode: n,
})

test('the kiosk plays an IPTV film from the Play alone, without the catalogue', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the kiosks are a TV and a desktop Chromium')
  await stayOffline(page)
  const catalogue: string[] = []
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/bion' && route.request().method() === 'GET') {
      // As the server does: everything after the cursor the kiosk sends.
      const commands = url.searchParams.get('after') === '4'
        ? [{ seq: 5, type: 'play', source: 'iptv', profileId: 'vera', itemId: 's_1', channel: ep(1), episodes: [ep(2), ep(3)] }]
        : []
      return route.fulfill({ json: { now: Date.now(), latest: 5, commands, status: null } })
    }
    if (url.pathname === '/api/preferences' && url.searchParams.get('profileId') === '_global') {
      return route.fulfill({ json: { m3u_url: M3U } })
    }
    return route.fulfill({ json: {} })
  })
  await page.route('**/proxy?**', (route) => { catalogue.push(route.request().url()); return route.abort() })
  await page.route(`${PROXY}/**`, (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/probe') {
      return route.fulfill({ json: { duration: 1448, startTime: 0, audioCodec: 'aac', videoCodec: 'h264', audioStreams: [], subtitleStreams: [] } })
    }
    return route.abort()
  })
  // WebKit loads media outside what page.route sees, so the source is written down where it is set.
  await page.addInitScript(() => {
    const srcs: string[] = []
    ;(window as unknown as { __srcs: string[] }).__srcs = srcs
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...desc,
      set(v: string) { if (v.includes('/transcode')) srcs.push(v); desc.set!.call(this, v) },
    })
  })

  // As the TV's app opens it: at the Play before the one it was woken for.
  await page.goto('/?kiosk=vardagsrum&after=4')

  await expect.poll(async () => {
    const srcs = await page.evaluate(() => (window as unknown as { __srcs: string[] }).__srcs)
    return srcs.map((s) => new URL(s).searchParams.get('url'))[0]
  }, { timeout: 15_000 }).toBe('http://iptv.krutofv.se/series/user1/pw1/1.mkv')

  // The next episodes are where the player looks for them.
  const ids = await page.evaluate(
    `import('/src/stores/playlistStore.ts').then((m) => m.usePlaylistStore.getState().channels.map((c) => c.id))`,
  )
  expect(ids).toEqual(['s_1', 's_2', 's_3'])
  expect(catalogue).toEqual([])
})

// A closed film lets go of its stream. The <video> unmounts with the film, and a
// detached element kept its request open until garbage collection: on Bion the closed
// film went on downloading for 40 s, and the account allows one connection, so the
// next film never got a frame (2026-10-24).
test('the kiosk lets go of the stream when the film stops', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the kiosks are a TV and a desktop Chromium')
  await stayOffline(page)
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/bion' && route.request().method() === 'GET') {
      const after = url.searchParams.get('after')
      const commands = after === '4'
        ? [{ seq: 5, type: 'play', source: 'iptv', profileId: 'vera', itemId: 's_1', channel: ep(1), episodes: [] }]
        : after === '5' ? [{ seq: 6, type: 'stop' }] : []
      return route.fulfill({ json: { now: Date.now(), latest: 6, commands, status: null } })
    }
    if (url.pathname === '/api/preferences' && url.searchParams.get('profileId') === '_global') {
      return route.fulfill({ json: { m3u_url: M3U } })
    }
    return route.fulfill({ json: {} })
  })
  await page.route('**/proxy?**', (route) => route.abort())
  await page.route(`${PROXY}/**`, (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/probe') {
      return route.fulfill({ json: { duration: 1448, startTime: 0, audioCodec: 'aac', videoCodec: 'h264', audioStreams: [], subtitleStreams: [] } })
    }
    return route.abort()
  })
  // Every element that was given a stream, so it can be asked after it has left the page.
  await page.addInitScript(() => {
    const els: HTMLMediaElement[] = []
    ;(window as unknown as { __els: HTMLMediaElement[] }).__els = els
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...desc,
      set(v: string) { if (v.includes('/transcode')) els.push(this); desc.set!.call(this, v) },
    })
  })

  await page.goto('/?kiosk=bion&after=4')

  const holding = () => page.evaluate(() => (window as unknown as { __els: HTMLMediaElement[] }).__els
    .filter((el) => el.hasAttribute('src')).length)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __els: HTMLMediaElement[] }).__els.length),
    { timeout: 15_000 }).toBeGreaterThan(0)
  await expect.poll(holding, { timeout: 15_000 }).toBe(0)
  await expect(page.locator('video')).toHaveCount(0)
})

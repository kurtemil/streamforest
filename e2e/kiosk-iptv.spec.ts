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

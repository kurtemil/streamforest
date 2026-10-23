import { test, expect, seedLibrary, stayOffline } from './fixtures'

// The IPTV account allows one connection to the provider. Gabby's Dollhouse on
// Bion (2026-10-23): the first request asked for track 1, Danish, and a switch to
// the profile's Swedish followed at once, a second /transcode that the provider
// cut. And from the second episode on, the choice ran on the previous episode's
// track list and was spent before the new one arrived, so it stayed Danish.
// Desktop WebKit takes the same path as the kiosk's Chromium: one fMP4 response.

const PROXY = 'http://localhost:8787'

const PROBE = {
  duration: 1448.49, startTime: 0, audioCodec: 'aac', videoCodec: 'h264',
  audioStreams: [
    { index: 1, codec: 'aac', channels: 2, lang: 'dan', title: 'Danish' },
    { index: 2, codec: 'aac', channels: 2, lang: 'nor', title: 'Norwegian' },
    { index: 3, codec: 'aac', channels: 2, lang: 'fin', title: 'Finnish' },
    { index: 4, codec: 'aac', channels: 2, lang: 'swe', title: 'Swedish' },
  ],
  subtitleStreams: [],
}

const EPISODES = [
  { id: 's_2001', name: 'Severance S01 Severance - S01E01', url: 'http://example.invalid/series/2001.mkv', logo: '', groupTitle: 'Series: Drama', type: 'series', sortIndex: 3, showName: 'Severance', season: 1, episode: 1, episodeTitle: 'Good News About Hell' },
  { id: 's_2002', name: 'Severance S01 Severance - S01E02', url: 'http://example.invalid/series/2002.mkv', logo: '', groupTitle: 'Series: Drama', type: 'series', sortIndex: 4, showName: 'Severance', season: 1, episode: 2, episodeTitle: 'Half Loop' },
]

test('the profile language is in the first request, episode after episode', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the kiosk path; iOS opens an HLS session instead')
  await stayOffline(page)
  await page.route(`${PROXY}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/probe') return route.fulfill({ json: PROBE })
    if (url.pathname === '/keyframe') return route.fulfill({ json: { keyframe: Number(url.searchParams.get('start')) } })
    return route.abort()
  })
  // WebKit loads media outside what page.route sees, so every source the player
  // hands the <video> is written down where it is set.
  await page.addInitScript(() => {
    const srcs: string[] = []
    ;(window as unknown as { __srcs: string[] }).__srcs = srcs
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...desc,
      set(v: string) { if (v.includes('/transcode')) srcs.push(v); desc.set!.call(this, v) },
    })
  })
  const all: URL[] = []
  const transcodes: URL[] = []
  const collect = async () => {
    const srcs = await page.evaluate(() => (window as unknown as { __srcs: string[] }).__srcs.splice(0))
    for (const s of srcs) { const u = new URL(s); all.push(u); transcodes.push(u) }
  }
  await page.addInitScript(() => {
    window.localStorage.setItem('sf-playback-prefs', JSON.stringify({
      state: { byProfile: { elof: { preferredAudioLang: 'sv' } }, byTitle: {} }, version: 0,
    }))
  })
  await seedLibrary(page)

  // The store the app itself uses, as the kiosk drives it: Vite serves the module once.
  const store = (call: string) => page.evaluate(
    `import('/src/stores/playerStore.ts').then((m) => m.usePlayerStore.getState().${call})`,
  )
  const firstFor = async (id: string) => {
    await expect.poll(async () => { await collect(); return transcodes.find((u) => u.searchParams.get('url')?.includes(id.slice(2))) }).toBeTruthy()
    return transcodes.find((u) => u.searchParams.get('url')?.includes(id.slice(2)))!
  }

  // A fresh player.
  await store(`play(${JSON.stringify(EPISODES[0])})`)
  expect((await firstFor('s_2001')).searchParams.get('audio')).toBe('4')

  // The next episode straight after, as autoplay and a new Play on Bion do.
  transcodes.length = 0
  await store(`play(${JSON.stringify(EPISODES[1])})`)
  expect((await firstFor('s_2002')).searchParams.get('audio')).toBe('4')

  // Closed in between, as the kiosk does before a new film.
  await store('close()')
  transcodes.length = 0
  await store(`play(${JSON.stringify(EPISODES[0])})`)
  expect((await firstFor('s_2001')).searchParams.get('audio')).toBe('4')

  // No request, retries included, ever asked for another track.
  await page.waitForTimeout(1500)
  await collect()
  expect(all.length).toBeGreaterThanOrEqual(3)
  expect(all.map((u) => u.searchParams.get('audio')).filter((a) => a !== '4')).toEqual([])
})

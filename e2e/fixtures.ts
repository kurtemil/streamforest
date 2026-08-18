import { test as base, expect, type Page } from '@playwright/test'

// The app blocks on a profile picker until one is chosen, and the choice is a PIN
// round trip. Seeding the persisted stores puts a test straight onto the page it
// means to exercise, without standing in for an auth flow it is not testing.
const PROFILE_KEY = 'sf-profile'
const M3U_KEY = 'sf_m3u_url'
const PROFILE_ID = 'elof'

// A library small enough to reason about and varied enough to render every card
// type: movies, a two-episode show, a live channel, and progress rows that put
// entries into Continue Watching.
const SEED_CHANNELS = [
  { id: 'm_1001', name: 'Arrival [2016]', url: 'http://example.invalid/movie/1001.mkv', logo: '', groupTitle: 'VOD: Sci-Fi', type: 'movie', sortIndex: 0, movieTitle: 'Arrival', year: 2016 },
  { id: 'm_1002', name: 'Sicario [2015]', url: 'http://example.invalid/movie/1002.mkv', logo: '', groupTitle: 'VOD: Thriller', type: 'movie', sortIndex: 1, movieTitle: 'Sicario', year: 2015 },
  { id: 'm_1003', name: 'Dune [2021]', url: 'http://example.invalid/movie/1003.mkv', logo: '', groupTitle: 'VOD: Sci-Fi', type: 'movie', sortIndex: 2, movieTitle: 'Dune', year: 2021 },
  { id: 's_2001', name: 'Severance S01 Severance - S01E01', url: 'http://example.invalid/series/2001.mkv', logo: '', groupTitle: 'Series: Drama', type: 'series', sortIndex: 3, showName: 'Severance', season: 1, episode: 1, episodeTitle: 'Good News About Hell' },
  { id: 's_2002', name: 'Severance S01 Severance - S01E02', url: 'http://example.invalid/series/2002.mkv', logo: '', groupTitle: 'Series: Drama', type: 'series', sortIndex: 4, showName: 'Severance', season: 1, episode: 2, episodeTitle: 'Half Loop' },
  { id: 'l_3001', name: 'SVT1 HD', url: 'http://example.invalid/3001', logo: '', groupTitle: 'Sweden', type: 'live', sortIndex: 5 },
] as const

const SEED_PROGRESS = [
  // Half-watched: belongs in Continue Watching, with a remove button on the card.
  { id: `${PROFILE_ID}:m_1001`, profileId: PROFILE_ID, channelId: 'm_1001', position: 3600, duration: 7200, lastWatched: 1_700_000_000_000, completed: false },
  { id: `${PROFILE_ID}:s_2001`, profileId: PROFILE_ID, channelId: 's_2001', position: 600, duration: 2700, lastWatched: 1_700_000_100_000, completed: false },
] as const

// A group large enough to page. The grid renders 60 at a time, so 130 needs the
// sentinel to fire twice — enough to catch an observer that attaches once and
// then never again, as well as one that never attaches at all.
export const PAGING_GROUP = 'VOD: Paging'
export const PAGING_COUNT = 130

const PAGED_MOVIES = Array.from({ length: PAGING_COUNT }, (_, i) => ({
  id: `m_9${String(i).padStart(3, '0')}`,
  name: `Paged Movie ${i + 1}`,
  url: `http://example.invalid/movie/9${i}.mkv`,
  logo: '',
  groupTitle: PAGING_GROUP,
  type: 'movie',
  sortIndex: 100 + i,
  movieTitle: `Paged Movie ${i + 1}`,
  year: 2000 + (i % 25),
}))

export async function seedProfile(page: Page, profileId: string = PROFILE_ID): Promise<void> {
  await page.addInitScript(
    ([profileKey, m3uKey, id]) => {
      window.localStorage.setItem(profileKey, JSON.stringify({ state: { activeProfileId: id }, version: 0 }))
      // Non-empty so HomePage renders the library rather than the welcome screen.
      window.localStorage.setItem(m3uKey, 'http://example.invalid/playlist.m3u')
    },
    [PROFILE_KEY, M3U_KEY, profileId] as const,
  )
}

/**
 * Put a small library into IndexedDB.
 *
 * Dexie owns the schema, so the app has to open the database first — writing to
 * a database this fixture created would produce one with no object stores. Hence
 * the load, seed, reload sequence.
 */
export async function seedLibrary(
  page: Page,
  extra: readonly Record<string, unknown>[] = [],
): Promise<void> {
  await seedProfile(page)
  await page.goto('/')
  await page.waitForFunction(() => (document.querySelector('#root')?.children.length ?? 0) > 0)

  await page.evaluate(async ({ channels, progress }) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('StreamForestDB')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['channels', 'playlistMeta', 'watchProgress'], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      for (const c of channels) tx.objectStore('channels').put(c)
      for (const p of progress) tx.objectStore('watchProgress').put(p)
      tx.objectStore('playlistMeta').put({
        id: 1,
        url: 'http://example.invalid/playlist.m3u',
        fetchedAt: Date.now(),
        entryCount: channels.length,
        movieCount: 3, seriesCount: 2, liveCount: 1,
      })
    })
    db.close()
  }, {
    channels: [...(SEED_CHANNELS as unknown as Record<string, unknown>[]), ...extra],
    progress: SEED_PROGRESS as unknown as Record<string, unknown>[],
  })

  await page.reload()
  // Not networkidle. Every card asks TMDB for artwork, so a library of any size
  // keeps a request in flight and the page never goes idle — the paging fixture
  // hit the fixture timeout before its first assertion. Waiting for the app to
  // have rendered is both the condition these tests actually need and one that
  // does not get slower as the seed grows.
  await page.waitForFunction(() => (document.querySelector('#root')?.children.length ?? 0) > 0)
}

/**
 * Console errors are a test result, not noise. React warnings, failed loads and
 * unhandled rejections all surface here, and on a page this dynamic they are
 * usually the first sign of a real regression.
 */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    // The transcode proxy, TMDB and the D1 API are all unreachable from a test
    // run; their fetch failures say nothing about the interface.
    if (/VITE_TRANSCODE_PROXY_URL|themoviedb|image\.tmdb|example\.invalid|Failed to load resource|net::ERR|\/api\//i.test(text)) return
    errors.push(text)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

export const test = base.extend<{ seededPage: Page; libraryPage: Page; pagedPage: Page }>({
  // Profile only — the app renders its welcome state.
  seededPage: async ({ page }, use) => {
    await seedProfile(page)
    await use(page)
  },
  // Profile plus a library, so card-level controls actually exist to audit.
  libraryPage: async ({ page }, use) => {
    await seedLibrary(page)
    await use(page)
  },
  // The same library with one group big enough to need more than one page.
  pagedPage: async ({ page }, use) => {
    await seedLibrary(page, PAGED_MOVIES)
    await use(page)
  },
})

export { expect }

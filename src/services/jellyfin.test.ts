import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authHeader, getPlaybackSource, getSession, listItems, posterUrl, reportPlayback, JELLYFIN_URL, type HomeItem } from './jellyfin'
import { orderForHome } from '@/stores/homeLibraryStore'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) },
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size },
  }
}

const item = (over: Partial<HomeItem> = {}): HomeItem => ({
  id: 'i1', name: 'Paul', kind: 'movie', durationSec: 6000, positionSec: 0, played: false,
  lastPlayedAt: 0, addedAt: 0, ...over,
})

describe('orderForHome', () => {
  it('puts started, unfinished titles first, most recently played on top, then newest', () => {
    const list = orderForHome([
      item({ id: 'new', name: 'B', addedAt: 3 }),
      item({ id: 'old', name: 'A', addedAt: 1 }),
      item({ id: 'resumeOld', positionSec: 600, lastPlayedAt: 10 }),
      item({ id: 'resumeNew', positionSec: 600, lastPlayedAt: 20 }),
      item({ id: 'finished', positionSec: 600, played: true, addedAt: 2 }),
      item({ id: 'barely', positionSec: 5, addedAt: 0 }),
    ])
    expect(list.map((i) => i.id)).toEqual(['resumeNew', 'resumeOld', 'new', 'finished', 'old', 'barely'])
  })
})

describe('jellyfin client', () => {
  let calls: { url: string; init: RequestInit }[]
  let respond: (url: string, init: RequestInit) => Response

  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    calls = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return respond(url, init) }))
  })
  afterEach(() => vi.unstubAllGlobals())

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

  it('sends an ASCII-only Authorization header — HTTP/2 rejects anything else with 400', () => {
    // eslint-disable-next-line no-control-regex
    expect(authHeader('tok')).toMatch(/^[\x20-\x7e]+$/)
  })

  it('signs in without a password once, then reuses the saved session', async () => {
    respond = () => json({ AccessToken: 'tok', User: { Id: 'u1' } })
    expect(await getSession('vera', 'Vera')).toEqual({ token: 'tok', userId: 'u1' })
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ Username: 'Vera', Pw: '' })
    expect(await getSession('vera', 'Vera')).toEqual({ token: 'tok', userId: 'u1' })
    expect(calls).toHaveLength(1)
  })

  it('maps items, with positions in seconds and the profile’s user', async () => {
    respond = () => json({ Items: [{
      Id: 'm1', Name: 'Troja', Type: 'Movie', ProductionYear: 2004, RunTimeTicks: 98_000_000_000,
      DateCreated: '2026-10-09T07:50:00Z', ImageTags: { Primary: 'abc' }, ProviderIds: { Tmdb: '652' },
      UserData: { PlaybackPositionTicks: 3_000_000_000, Played: false, LastPlayedDate: '2026-10-10T20:00:00Z' },
    }, { Id: 'v1', Name: 'Allsvenskan 2012', Type: 'Video' }] })
    const items = await listItems({ token: 'tok', userId: 'u1' })
    expect(calls[0].url).toContain('userId=u1')
    expect(String((calls[0].init.headers as Record<string, string>).Authorization)).toContain('Token="tok"')
    expect(items[0]).toMatchObject({ id: 'm1', kind: 'movie', durationSec: 9800, positionSec: 300, tmdbId: '652', year: 2004 })
    expect(items[1]).toMatchObject({ id: 'v1', kind: 'video', positionSec: 0, imageTag: undefined })
    expect(posterUrl(items[0])).toBe(`${JELLYFIN_URL}/Items/m1/Images/Primary?fillWidth=300&quality=90&tag=abc`)
    expect(posterUrl(items[1])).toBeNull()
  })

  it('plays the server’s HLS when it transcodes, and the file when it can be played as is', async () => {
    respond = () => json({ PlaySessionId: 'ps', MediaSources: [{ Id: 'ms', TranscodingUrl: '/videos/m1/master.m3u8?ApiKey=tok' }] })
    const hls = await getPlaybackSource({ token: 'tok', userId: 'u1' }, item({ id: 'm1' }))
    expect(hls).toEqual({ url: `${JELLYFIN_URL}/videos/m1/master.m3u8?ApiKey=tok`, hls: true, itemId: 'm1', mediaSourceId: 'ms', playSessionId: 'ps' })

    respond = () => json({ PlaySessionId: 'ps2', MediaSources: [{ Id: 'ms2', Container: 'mp4', SupportsDirectPlay: true }] })
    const file = await getPlaybackSource({ token: 'tok', userId: 'u1' }, item({ id: 'm2' }))
    expect(file.hls).toBe(false)
    expect(file.url).toMatch(new RegExp(`^${JELLYFIN_URL}/Videos/m2/stream\\.mp4\\?`))
    const q = new URL(file.url).searchParams
    expect(q.get('static')).toBe('true')
    expect(q.get('ApiKey')).toBe('tok') // native players cannot send the header
    expect(q.get('playSessionId')).toBe('ps2')
  })

  it('reports positions in ticks and never throws when the server is gone', async () => {
    respond = () => json({}, 204)
    const src = { url: 'x', hls: true, itemId: 'm1', mediaSourceId: 'ms', playSessionId: 'ps' }
    await reportPlayback({ token: 'tok', userId: 'u1' }, src, 'progress', 12.5, true)
    expect(calls[0].url).toBe(`${JELLYFIN_URL}/Sessions/Playing/Progress`)
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ PositionTicks: 125_000_000, IsPaused: true, PlaySessionId: 'ps', PlayMethod: 'Transcode' })
    respond = () => { throw new TypeError('fetch failed') }
    await expect(reportPlayback({ token: 'tok', userId: 'u1' }, src, 'stopped', 1)).resolves.toBeUndefined()
  })
})

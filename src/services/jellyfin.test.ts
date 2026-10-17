import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authHeader, backdropUrl, combineParts, forgetSession, getDetails, getPlaybackSource, getSession, listItems, locatePart, posterUrl, reportPlayback, setPlayed, JELLYFIN_URL, type HomeItem, type HomePart } from './jellyfin'
import { orderForHome, useHomeLibraryStore } from '@/stores/homeLibraryStore'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) },
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size },
  }
}

const item = (over: Partial<HomeItem> = {}): HomeItem => ({
  id: 'i1', name: 'Paul', kind: 'movie', library: 'Filmer', durationSec: 6000, positionSec: 0, played: false,
  lastPlayedAt: 0, addedAt: 0, genres: [], ...over,
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

  it('maps items per library, with positions in seconds and the profile’s user', async () => {
    respond = (url) => {
      if (url.includes('/UserViews')) return json({ Items: [
        { Id: 'lib-film', Name: 'Filmer', CollectionType: 'movies' },
        { Id: 'lib-fot', Name: 'Fotboll', CollectionType: 'homevideos' },
        { Id: 'lib-box', Name: 'Samlingar', CollectionType: 'boxsets' },
      ] })
      if (url.includes('parentId=lib-film')) return json({ Items: [{
        Id: 'm1', Name: 'Troja', Type: 'Movie', ProductionYear: 2004, RunTimeTicks: 98_000_000_000,
        DateCreated: '2026-10-09T07:50:00Z', ImageTags: { Primary: 'abc' }, ProviderIds: { Tmdb: '652' },
        BackdropImageTags: ['bd1'], Genres: ['Action', 'Drama'], CommunityRating: 6.9, OfficialRating: 'SE-15',
        UserData: { PlaybackPositionTicks: 3_000_000_000, Played: false, LastPlayedDate: '2026-10-10T20:00:00Z' },
      }] })
      if (url.includes('parentId=lib-fot')) return json({ Items: [{ Id: 'v1', Name: 'Allsvenskan 2012', Type: 'Video' }] })
      throw new Error('unexpected ' + url)
    }
    const items = await listItems({ token: 'tok', userId: 'u1' })
    expect(calls.every((c) => c.url.includes('userId=u1'))).toBe(true)
    expect(calls.some((c) => c.url.includes('lib-box'))).toBe(false) // collections are not playable items
    expect(String((calls[0].init.headers as Record<string, string>).Authorization)).toContain('Token="tok"')
    expect(items[0]).toMatchObject({ id: 'm1', kind: 'movie', library: 'Filmer', durationSec: 9800, positionSec: 300, tmdbId: '652', year: 2004 })
    expect(items[1]).toMatchObject({ id: 'v1', kind: 'video', library: 'Fotboll', positionSec: 0, imageTag: undefined })
    expect(posterUrl(items[0])).toBe(`${JELLYFIN_URL}/Items/m1/Images/Primary?fillWidth=300&quality=90&tag=abc`)
    expect(posterUrl(items[1])).toBeNull()
    // What the detail sheet shows at once, before the people have loaded.
    expect(items[0]).toMatchObject({ genres: ['Action', 'Drama'], rating: 6.9, ageRating: 'SE-15' })
    expect(backdropUrl(items[0])).toBe(`${JELLYFIN_URL}/Items/m1/Images/Backdrop/0?fillWidth=1280&quality=80&tag=bd1`)
    expect(items[1]).toMatchObject({ genres: [], rating: undefined, ageRating: undefined })
    expect(backdropUrl(items[1])).toBeNull()
    expect(calls.find((c) => c.url.includes('parentId=lib-film'))!.url).toContain('Genres')
  })

  it('reads the people for the detail sheet: directors, and up to twelve actors with pictures', async () => {
    const actors = Array.from({ length: 15 }, (_, n) => ({ Id: `a${n}`, Name: `Actor ${n}`, Role: `Role ${n}`, Type: 'Actor', PrimaryImageTag: n === 1 ? undefined : `t${n}` }))
    respond = (url) => {
      if (url.includes('/Similar')) {
        expect(url).toBe(`${JELLYFIN_URL}/Items/m1/Similar?userId=u1&limit=12`)
        return json({ Items: [{ Id: 'm7' }, { Id: 'm9' }] })
      }
      expect(url).toBe(`${JELLYFIN_URL}/Items/m1?userId=u1`)
      return json({ People: [
        { Id: 'd1', Name: 'Wolfgang Petersen', Type: 'Director' },
        { Id: 'w1', Name: 'David Benioff', Type: 'Writer' },
        ...actors,
      ] })
    }
    const d = await getDetails({ token: 'tok', userId: 'u1' }, 'm1')
    expect(d.director).toBe('Wolfgang Petersen')
    expect(d.cast).toHaveLength(12)
    expect(d.cast[0]).toEqual({ name: 'Actor 0', character: 'Role 0', image: `${JELLYFIN_URL}/Items/a0/Images/Primary?fillWidth=92&quality=90&tag=t0` })
    expect(d.cast[1].image).toBeNull()
    expect(d.cast.some((c) => c.name === 'David Benioff')).toBe(false)
    expect(d.similar).toEqual(['m7', 'm9'])
  })

  it('marks watched with POST and unwatched with DELETE, as the profile’s user', async () => {
    respond = () => new Response(null, { status: 200 })
    await setPlayed({ token: 'tok', userId: 'u1' }, 'm1', true)
    await setPlayed({ token: 'tok', userId: 'u1' }, 'm1', false)
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', `${JELLYFIN_URL}/UserPlayedItems/m1?userId=u1`],
      ['DELETE', `${JELLYFIN_URL}/UserPlayedItems/m1?userId=u1`],
    ])
  })

  it('forgets only the token the server refused, not a newer one saved meanwhile', async () => {
    respond = () => json({ AccessToken: 'new', User: { Id: 'u1' } })
    await getSession('noah', 'Noah')
    forgetSession('noah', 'old')
    expect(await getSession('noah', 'Noah')).toEqual({ token: 'new', userId: 'u1' })
    forgetSession('noah', 'new')
    respond = () => json({ AccessToken: 'newer', User: { Id: 'u1' } })
    expect(await getSession('noah', 'Noah')).toEqual({ token: 'newer', userId: 'u1' })
  })

  it('signs in once when two loads start together, so neither revokes the other', async () => {
    // Jellyfin revokes a device's token when the same device signs in again. Two
    // concurrent loads each signed in, and the first one's list came back 401.
    let tokens = 0
    respond = (url) => {
      if (url.includes('/System/Info/Public')) return json({})
      if (url.includes('/Users/AuthenticateByName')) return json({ AccessToken: `t${++tokens}`, User: { Id: 'u1' } })
      if (url.includes('/UserViews')) return json({ Items: [{ Id: 'lib', Name: 'Filmer', CollectionType: 'movies' }] })
      if (url.includes('/Items')) return json({ Items: [{ Id: 'm1', Name: 'Troja', Type: 'Movie' }] })
      throw new Error('unexpected ' + url)
    }
    const { load } = useHomeLibraryStore.getState()
    await Promise.all([load('jossan', 'Jossan'), load('jossan', 'Jossan')])
    expect(tokens).toBe(1)
    const state = useHomeLibraryStore.getState()
    expect(state.status).toBe('ready')
    expect(state.session).toEqual({ token: 't1', userId: 'u1' })
    expect(state.items.map((i) => i.id)).toEqual(['m1'])
  })

  it('plays the server’s HLS when it transcodes, and the file when it can be played as is', async () => {
    respond = () => json({ PlaySessionId: 'ps', MediaSources: [{ Id: 'm1', TranscodingUrl: '/videos/m1/master.m3u8?ApiKey=tok' }] })
    const hls = await getPlaybackSource({ token: 'tok', userId: 'u1' }, 'm1')
    expect(hls).toEqual({ url: `${JELLYFIN_URL}/videos/m1/master.m3u8?ApiKey=tok`, hls: true, itemId: 'm1', mediaSourceId: 'm1', playSessionId: 'ps', subtitles: [], burntIn: undefined })

    respond = () => json({ PlaySessionId: 'ps2', MediaSources: [{ Id: 'm2', Container: 'mp4', SupportsDirectPlay: true }] })
    const file = await getPlaybackSource({ token: 'tok', userId: 'u1' }, 'm2')
    expect(file.hls).toBe(false)
    expect(file.url).toMatch(new RegExp(`^${JELLYFIN_URL}/Videos/m2/stream\\.mp4\\?`))
    const q = new URL(file.url).searchParams
    expect(q.get('static')).toBe('true')
    expect(q.get('ApiKey')).toBe('tok') // native players cannot send the header
    expect(q.get('playSessionId')).toBe('ps2')
  })

  it('asks for clean pictures unless a picture subtitle is to be burnt in, always naming the media source', async () => {
    // The server ignores a subtitle choice without a MediaSourceId and burns in
    // the file's default stream instead, which is what Hit and Run did until now.
    respond = () => json({ PlaySessionId: 'ps', MediaSources: [{ Id: 'm1', TranscodingUrl: '/x.m3u8', MediaStreams: [
      { Type: 'Video', Index: 0 },
      { Type: 'Subtitle', Index: 2, Language: 'swe', IsTextSubtitleStream: true, DeliveryMethod: 'External', DeliveryUrl: '/Videos/m1/m1/Subtitles/2/0/Stream.vtt?ApiKey=tok', IsDefault: true },
      { Type: 'Subtitle', Index: 3, Language: 'nor', IsTextSubtitleStream: false, DeliveryMethod: 'Encode' },
    ] }] })
    const clean = await getPlaybackSource({ token: 'tok', userId: 'u1' }, 'm1')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ MediaSourceId: 'm1', SubtitleStreamIndex: -1 })
    expect(clean.subtitles).toEqual([
      { index: 2, lang: 'swe', title: undefined, text: true, url: `${JELLYFIN_URL}/Videos/m1/m1/Subtitles/2/0/Stream.vtt?ApiKey=tok`, forced: false, isDefault: true },
      { index: 3, lang: 'nor', title: undefined, text: false, url: undefined, forced: false, isDefault: false },
    ])
    const burnt = await getPlaybackSource({ token: 'tok', userId: 'u1' }, 'm1', { burnIn: 3 })
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ MediaSourceId: 'm1', SubtitleStreamIndex: 3 })
    expect(burnt.burntIn).toBe(3)
  })

  it('reads every file of a split film and treats it as one film', async () => {
    respond = (url) => {
      if (url.includes('/UserViews')) return json({ Items: [{ Id: 'lib', Name: 'Filmer', CollectionType: 'movies' }] })
      if (url.includes('/AdditionalParts')) {
        expect(url).toBe(`${JELLYFIN_URL}/Videos/av/AdditionalParts?userId=u1`)
        return json({ Items: [
          { Id: 'av2', Name: 'Avatar', Type: 'Movie', RunTimeTicks: 32_400_000_000, UserData: { PlaybackPositionTicks: 6_000_000_000, Played: false } },
          { Id: 'av3', Name: 'Avatar', Type: 'Movie', RunTimeTicks: 28_800_000_000 },
        ] })
      }
      if (url.includes('/Items')) return json({ Items: [
        { Id: 'av', Name: 'Avatar', Type: 'Movie', PartCount: 3, RunTimeTicks: 35_400_000_000, UserData: { Played: true } },
        { Id: 'm1', Name: 'Troja', Type: 'Movie', RunTimeTicks: 98_000_000_000 },
      ] })
      throw new Error('unexpected ' + url)
    }
    const [avatar, troja] = await listItems({ token: 'tok', userId: 'u1' })
    expect(avatar.parts?.map((p) => p.id)).toEqual(['av', 'av2', 'av3'])
    // 59 + 54 + 48 minutes, part one seen, ten minutes into part two.
    expect(avatar).toMatchObject({ durationSec: 9660, positionSec: 3540 + 600, played: false })
    expect(troja.parts).toBeUndefined()
    expect(calls.filter((c) => c.url.includes('AdditionalParts'))).toHaveLength(1)
  })

  it('reports positions in ticks and never throws when the server is gone', async () => {
    respond = () => json({}, 204)
    const src = { url: 'x', hls: true, itemId: 'm1', mediaSourceId: 'ms', playSessionId: 'ps', subtitles: [] }
    await reportPlayback({ token: 'tok', userId: 'u1' }, src, 'progress', 12.5, true)
    expect(calls[0].url).toBe(`${JELLYFIN_URL}/Sessions/Playing/Progress`)
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ PositionTicks: 125_000_000, IsPaused: true, PlaySessionId: 'ps', PlayMethod: 'Transcode' })
    respond = () => { throw new TypeError('fetch failed') }
    await expect(reportPlayback({ token: 'tok', userId: 'u1' }, src, 'stopped', 1)).resolves.toBeUndefined()
  })
})

describe('split films', () => {
  const part = (id: string, durationSec: number, over: Partial<HomePart> = {}): HomePart =>
    ({ id, durationSec, positionSec: 0, played: false, lastPlayedAt: 0, ...over })

  it('is watched only when every part is', () => {
    expect(combineParts([part('a', 100, { played: true }), part('b', 100)]).played).toBe(false)
    expect(combineParts([part('a', 100, { played: true }), part('b', 100, { played: true })])).toMatchObject({ played: true, positionSec: 0 })
  })

  it('resumes at the start of the next part once a part is finished', () => {
    expect(combineParts([part('a', 3540, { played: true }), part('b', 3240)]).positionSec).toBe(3540)
  })

  it('finds the part a position falls in, and stays in the last one past the end', () => {
    const parts = [part('a', 100), part('b', 50), part('c', 80)]
    expect(locatePart(parts, 0)).toEqual({ index: 0, offsetSec: 0 })
    expect(locatePart(parts, 120)).toEqual({ index: 1, offsetSec: 20 })
    expect(locatePart(parts, 150)).toEqual({ index: 2, offsetSec: 0 })
    expect(locatePart(parts, 999)).toEqual({ index: 2, offsetSec: 849 })
  })
})

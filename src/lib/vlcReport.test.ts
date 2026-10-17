import { describe, expect, it } from 'vitest'
import { buildM3u, decodePlaylist, decodeReport, encodePlaylist, encodeReport } from './vlcPlaylist'
import { currentEntry, jellyfinRelay, parseSrc, progressRow } from './vlcReport'

const ORIGIN = 'https://streamforest.krutofv.se'
const HOST = 'http://example.invalid:2095/series/USER/PASS'
const season = [
  { title: 'Show S01E01', url: `${HOST}/101.mkv`, id: 's_101', start: 754.6 },
  { title: 'Show S01E02', url: `${HOST}/102.mkv`, id: 's_102' },
]
const link = (items = season, r = encodeReport({ k: 'sf', p: 'elof' })) =>
  `${ORIGIN}/api/playlist/Show.m3u?d=${encodePlaylist(items)}&r=${r}`

describe('playlist entries that remember where to start', () => {
  it('round-trips the start and the id, and still reads entries without them', () => {
    expect(decodePlaylist(encodePlaylist(season))).toEqual([
      { title: 'Show S01E01', url: `${HOST}/101.mkv`, id: 's_101', start: 754 },
      { title: 'Show S01E02', url: `${HOST}/102.mkv`, id: 's_102' },
    ])
  })

  it('tells VLC where to start with a start-time option before the entry', () => {
    expect(buildM3u(decodePlaylist(encodePlaylist(season)))).toBe(
      `#EXTM3U\n#EXTINF:-1,Show S01E01\n#EXTVLCOPT:start-time=754\n${HOST}/101.mkv\n#EXTINF:-1,Show S01E02\n${HOST}/102.mkv\n`,
    )
  })

  it('accepts only the two report targets it writes', () => {
    expect(decodeReport(encodeReport({ k: 'jf', u: 'a4ca78de', t: 'tok123' }))).toEqual({ k: 'jf', u: 'a4ca78de', t: 'tok123' })
    expect(() => decodeReport(encodeReport({ k: 'jf', u: 'a4ca', t: 'x"; rm -rf' } as never))).toThrow()
    expect(() => decodeReport('e30')).toThrow()
  })
})

describe('a report from VLC', () => {
  it('is read from a link on this origin only', () => {
    expect(parseSrc(link(), ORIGIN)?.target).toEqual({ k: 'sf', p: 'elof' })
    expect(parseSrc(link(), 'https://elsewhere.example')).toBeNull()
    expect(parseSrc(`${ORIGIN}/api/playlist/x.m3u?d=${encodePlaylist(season)}`, ORIGIN)).toBeNull()
  })

  it('belongs to the entry VLC says is playing', () => {
    expect(currentEntry(season, `${HOST}/102.mkv`)?.id).toBe('s_102')
    expect(currentEntry(season, undefined)).toBeNull()
    expect(currentEntry([season[0]], undefined)?.id).toBe('s_101')
  })

  it('reads a URI with JSON escapes left in, and a home film part by the id in its path', () => {
    const parts = [
      { title: 'Avatar (1/3)', url: 'https://jellyfin.krutofv.se/Videos/av1/stream?static=true&ApiKey=t', id: 'av1' },
      { title: 'Avatar (2/3)', url: 'https://jellyfin.krutofv.se/Videos/av2/stream?static=true&ApiKey=t', id: 'av2' },
    ]
    expect(currentEntry(parts, 'https:\\/\\/jellyfin.krutofv.se\\/Videos\\/av2\\/stream?static=true\\u0026ApiKey=t')?.id).toBe('av2')
    expect(currentEntry(parts, 'https://jellyfin.krutofv.se/Videos/av1/stream?ApiKey=t&static=true')?.id).toBe('av1')
  })

  it('writes the profile’s row, finished past ninety per cent', () => {
    const target = { k: 'sf', p: 'elof' } as const
    expect(progressRow(target, season[0], { src: '', time: 1200, length: 2700, state: 'playing' }, 5)).toEqual({
      profileId: 'elof', channelId: 's_101', position: 1200, duration: 2700, lastWatched: 5, completed: false,
    })
    expect(progressRow(target, season[0], { src: '', time: 2650, length: 2700, state: 'playing' }, 5)?.completed).toBe(true)
    // The first seconds, or a live stream with no length, say nothing.
    expect(progressRow(target, season[0], { src: '', time: 4, length: 2700, state: 'playing' }, 5)).toBeNull()
    expect(progressRow(target, season[0], { src: '', time: 400, length: 0, state: 'playing' }, 5)).toBeNull()
  })

  it('becomes a Jellyfin report for a home film: started, progress, stopped', () => {
    const target = { k: 'jf', u: 'u1', t: 'tok' } as const
    const part = { title: 'Avatar', url: 'https://jellyfin.krutofv.se/Videos/av2/stream.avi', id: 'av2' }
    const base = { src: '', time: 600, length: 3240, state: 'paused' }
    expect(jellyfinRelay(target, part, { ...base, first: true })?.path).toBe('/Sessions/Playing')
    const progress = jellyfinRelay(target, part, base)!
    expect(progress.path).toBe('/Sessions/Playing/Progress')
    expect(progress.auth).toContain('Token="tok"')
    expect(JSON.parse(progress.body)).toEqual({ ItemId: 'av2', PositionTicks: 6_000_000_000, IsPaused: true, CanSeek: true, PlayMethod: 'DirectPlay' })
    expect(jellyfinRelay(target, part, { ...base, final: true })?.path).toBe('/Sessions/Playing/Stopped')
  })
})

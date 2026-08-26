import { describe, it, expect } from 'vitest'
import { buildM3u, decodePlaylist, encodePlaylist } from './vlcPlaylist'

// The browser encodes and the Pages Function decodes, in separate bundles that
// can drift apart without anything failing to build. These tests are the only
// place the two halves meet.

const HOST = 'http://example.invalid:2095/series/USER/PASS'

function season(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    title: `Show S01E${String(i + 1).padStart(2, '0')}`,
    url: `${HOST}/${100000 + i}.mkv`,
  }))
}

describe('encode/decode', () => {
  it('round-trips a season unchanged', () => {
    const items = season(12)
    expect(decodePlaylist(encodePlaylist(items))).toEqual(items)
  })

  it('round-trips non-ASCII titles', () => {
    const items = [
      { title: 'Bäst i test S02E03 · Höjdaren', url: `${HOST}/1.mkv` },
      { title: 'Bäst i test S02E04', url: `${HOST}/2.mkv` },
    ]
    expect(decodePlaylist(encodePlaylist(items))).toEqual(items)
  })

  it('survives urls with nothing in common', () => {
    const items = [
      { title: 'A', url: 'http://a.invalid/1.mkv' },
      { title: 'B', url: 'https://b.invalid/2.mkv' },
    ]
    expect(decodePlaylist(encodePlaylist(items))).toEqual(items)
  })

  // The prefix lift is what keeps a season inside the deeplink length cap in
  // src/lib/vlc.ts — if it stops working, seasons quietly start downloading a
  // file instead of opening VLC.
  it('costs little per episode once the host is hoisted', () => {
    const perEpisode = (encodePlaylist(season(40)).length - encodePlaylist(season(20)).length) / 20
    expect(perEpisode).toBeLessThan(40)
  })

  it('rejects a token that decodes to a non-http url', () => {
    const forged = encodePlaylist([
      { title: 'x', url: 'file:///etc/passwd' },
      { title: 'y', url: 'file:///etc/hosts' },
    ])
    expect(() => decodePlaylist(forged)).toThrow()
  })

  it('rejects junk', () => {
    expect(() => decodePlaylist('not-a-token')).toThrow()
  })
})

describe('buildM3u', () => {
  it('writes one EXTINF per entry, in order', () => {
    expect(buildM3u(season(2))).toBe(
      '#EXTM3U\n'
      + `#EXTINF:-1,Show S01E01\n${HOST}/100000.mkv\n`
      + `#EXTINF:-1,Show S01E02\n${HOST}/100001.mkv\n`,
    )
  })

  it('keeps a title from forging a playlist line', () => {
    const m3u = buildM3u([{ title: 'A\n#EXTINF:-1,B\nhttp://evil.invalid/x', url: `${HOST}/1.mkv` }])
    expect(m3u.split('\n').filter((l) => l.startsWith('#EXTINF'))).toHaveLength(1)
  })
})

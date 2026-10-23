import { describe, expect, it } from 'vitest'
import { needsProviderMove, redactStreamUrl, restoreStreamUrl, toPlaylistHost } from './provider'

describe('redactStreamUrl and restoreStreamUrl', () => {
  const m3u = 'http://iptv.krutofv.se/get.php?username=user1&password=pw1&type=m3u_plus'

  it('takes the account out of a stream URL, and the kiosk puts it back', () => {
    const url = 'http://iptv.krutofv.se/series/user1/pw1/1202599.mkv'
    const redacted = redactStreamUrl(url, m3u)
    expect(redacted).toBe('http://iptv.krutofv.se/series/~/~/1202599.mkv')
    expect(restoreStreamUrl(redacted!, m3u)).toBe(url)
    expect(redactStreamUrl('http://iptv.krutofv.se:2095/user1/pw1/1234', m3u)).toBe('http://iptv.krutofv.se:2095/~/~/1234')
  })

  it('gives nothing it could not carry safely or fill back in', () => {
    expect(redactStreamUrl('http://iptv.krutofv.se/movie/someone/else/1.mkv', m3u)).toBeNull()
    expect(redactStreamUrl('http://iptv.krutofv.se/movie/user1/pw1/1.mkv', null)).toBeNull()
    expect(restoreStreamUrl('http://iptv.krutofv.se/movie/~/~/1.mkv', '')).toBeNull()
    expect(restoreStreamUrl('http://iptv.krutofv.se/movie/user1/pw1/1.mkv', m3u)).toBeNull()
  })
})

describe('needsProviderMove', () => {
  it('is true for a URL naming the provider by IP or by its own domain', () => {
    expect(needsProviderMove('http://203.0.113.7:2095/get.php?username=u&password=p')).toBe(true)
    expect(needsProviderMove(' http://nsclient.xyz:2095/get.php?username=u&password=p ')).toBe(true)
  })
  it('is false for a URL already on our name, or for anything that is not a URL', () => {
    expect(needsProviderMove('http://iptv.krutofv.se:2095/get.php?username=u&password=p')).toBe(false)
    expect(needsProviderMove('')).toBe(false)
    expect(needsProviderMove('get.php?username=u')).toBe(false)
  })
})

const M3U = 'http://iptv.krutofv.se:2095/get.php?username=user1&password=pw1&type=m3u_plus&output=ts'

describe('toPlaylistHost', () => {
  it('moves a movie off a dead panel domain onto the playlist host', () => {
    expect(toPlaylistHost('http://nsclient.xyz:2095/movie/user1/pw1/491222.mkv', M3U))
      .toBe('http://iptv.krutofv.se:2095/movie/user1/pw1/491222.mkv')
  })

  it('moves series and live URLs, including the bare /user/pass/id form', () => {
    expect(toPlaylistHost('http://nsclient.xyz:2095/series/user1/pw1/77.mkv', M3U))
      .toBe('http://iptv.krutofv.se:2095/series/user1/pw1/77.mkv')
    expect(toPlaylistHost('http://nsclient.xyz:2095/user1/pw1/1234', M3U))
      .toBe('http://iptv.krutofv.se:2095/user1/pw1/1234')
  })

  it('moves a URL that names the provider by IP', () => {
    expect(toPlaylistHost('http://45.12.1.27:2095/live/user1/pw1/9.ts', M3U))
      .toBe('http://iptv.krutofv.se:2095/live/user1/pw1/9.ts')
  })

  it('keeps the stream URL’s own port: only the host name is unreliable', () => {
    expect(toPlaylistHost('http://old.example:8080/movie/user1/pw1/1.mp4', M3U))
      .toBe('http://iptv.krutofv.se:8080/movie/user1/pw1/1.mp4')
    // The real shape: playlist on port 80, streams named on 2095.
    const onPort80 = 'http://iptv.krutofv.se/get.php?username=user1&password=pw1&type=m3u_plus'
    expect(toPlaylistHost('http://nsclient.xyz:2095/movie/user1/pw1/491222.mkv', onPort80))
      .toBe('http://iptv.krutofv.se:2095/movie/user1/pw1/491222.mkv')
  })

  it('leaves URLs without the account credentials alone', () => {
    const other = 'https://cdn.example.com/some/stream.m3u8'
    expect(toPlaylistHost(other, M3U)).toBe(other)
    // Same username, different password: not this account.
    const lookalike = 'http://nsclient.xyz:2095/movie/user1/other/1.mkv'
    expect(toPlaylistHost(lookalike, M3U)).toBe(lookalike)
  })

  it('leaves URLs already on the playlist host alone', () => {
    const same = 'http://iptv.krutofv.se:2095/movie/user1/pw1/1.mkv'
    expect(toPlaylistHost(same, M3U)).toBe(same)
  })

  it('does nothing without a usable playlist URL', () => {
    const url = 'http://nsclient.xyz:2095/movie/user1/pw1/1.mkv'
    expect(toPlaylistHost(url, null)).toBe(url)
    expect(toPlaylistHost(url, 'not a url')).toBe(url)
    expect(toPlaylistHost(url, 'http://iptv.krutofv.se:2095/playlist.m3u')).toBe(url)
  })
})

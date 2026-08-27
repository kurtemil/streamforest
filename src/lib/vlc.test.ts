import { describe, it, expect } from 'vitest'
import { vlcSchemeLink } from './vlc'

// The page builds the vlc:// link; the installed handlers (vlc-handler.sh's
// AppleScript on macOS, vlc-handler.ps1's VBScript on Windows) decode it back.
// They live in different languages in different bundles and nothing else fails
// if they drift — these tests pin the two facts the contract stands on.

// What both handlers do after stripping "vlc://": decode %3A back to colons.
function handlerDecode(link: string): string {
  return link.slice('vlc://'.length).replace(/%3A/g, ':')
}

describe('vlcSchemeLink', () => {
  // Node's URL is the same WHATWG parser every browser runs the link through
  // before dispatching it to the OS. Unchanged here means unchanged there.
  it('survives the browser URL parser byte for byte', () => {
    for (const target of [
      'https://streamforest.krutofv.se/api/playlist/Serie_S01.m3u?d=eyJiIjoi',
      'http://example.invalid:2095/movie/USER/PASS/123456.mkv',
    ]) {
      const link = vlcSchemeLink(target)
      expect(new URL(link).href).toBe(link)
    }
  })

  it('decodes back to the exact target on the handler side', () => {
    const target = 'http://example.invalid:2095/series/USER/PASS/100001.mkv'
    expect(handlerDecode(vlcSchemeLink(target))).toBe(target)
  })

  // The reason the helper exists: a literal colon does NOT survive. The parser
  // reads `https:` as host-plus-empty-port and serializes the colon away, so
  // the handler would receive a string that is no longer a URL. If this ever
  // starts passing, browsers changed and the encoding can be reconsidered.
  it('documents that the naive link is rewritten by the parser', () => {
    expect(new URL('vlc://https://host.invalid/x.m3u').href)
      .toBe('vlc://https//host.invalid/x.m3u')
  })
})

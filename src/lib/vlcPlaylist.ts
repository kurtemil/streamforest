// The wire format behind the season playlists StreamForest hands to VLC.
//
// Two callers share this file and must agree byte for byte:
//   • the browser (`src/lib/vlc.ts`) encodes a season into a token
//   • the Pages Function (`functions/api/playlist/[name].ts`) decodes it back
//     and answers with the .m3u
//
// It therefore imports nothing — the Function bundles it by relative path, out
// of reach of the `@/` alias and of anything that touches the DOM.
//
// Why a token in the URL rather than a stored playlist: the app has nowhere to
// put per-request state that VLC could later fetch (KV is the M3U cache, D1 is
// profiles), and a link that carries its own contents needs no cleanup and no
// expiry. The cost is URL length, which `src/lib/vlc.ts` caps.

export interface PlaylistItem {
  title: string
  url: string
}

/** Wire payload: a common URL prefix lifted out, plus [title, suffix] pairs. */
interface Payload {
  b: string
  i: [string, string][]
}

// A provider's episode URLs differ only in the last path segment, so hoisting
// the shared prefix roughly halves the token — the difference between a season
// that deeplinks and one that falls back to a download.
function commonPrefix(values: string[]): string {
  if (values.length === 0) return ''
  let prefix = values[0]
  for (const value of values) {
    let i = 0
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i++
    prefix = prefix.slice(0, i)
    if (prefix === '') break
  }
  return prefix
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(token: string): string {
  const padded = token.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function encodePlaylist(items: PlaylistItem[]): string {
  const base = commonPrefix(items.map((i) => i.url))
  const payload: Payload = {
    b: base,
    i: items.map((i) => [i.title, i.url.slice(base.length)]),
  }
  return toBase64Url(JSON.stringify(payload))
}

/** Reverse of `encodePlaylist`. Throws on anything it did not produce. */
export function decodePlaylist(token: string): PlaylistItem[] {
  const payload = JSON.parse(fromBase64Url(token)) as Payload
  if (typeof payload?.b !== 'string' || !Array.isArray(payload.i)) {
    throw new Error('malformed playlist payload')
  }
  if (payload.i.length === 0 || payload.i.length > 1000) {
    throw new Error('playlist item count out of range')
  }
  return payload.i.map(([title, suffix]) => {
    if (typeof title !== 'string' || typeof suffix !== 'string') {
      throw new Error('malformed playlist entry')
    }
    const url = payload.b + suffix
    // The endpoint hands this to a media player on someone's machine, so it
    // only ever emits the two schemes a stream can arrive over.
    if (!/^https?:\/\//i.test(url)) throw new Error('unsupported url scheme')
    return { title, url }
  })
}

/** An extended M3U — one `#EXTINF` per entry, which is what makes VLC show titles. */
export function buildM3u(items: PlaylistItem[]): string {
  const lines = ['#EXTM3U']
  for (const { title, url } of items) {
    // A newline in a title would fabricate a playlist line of its own.
    lines.push(`#EXTINF:-1,${title.replace(/[\r\n]+/g, ' ').trim()}`, url)
  }
  return lines.join('\n') + '\n'
}

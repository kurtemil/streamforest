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
  /** Seconds to start at: where the profile left this item. VLC reads it as `start-time`. */
  start?: number
  /** Whose position this is when VLC reports back: a channel id, or a Jellyfin item id. */
  id?: string
}

/** Wire payload: a common URL prefix lifted out, plus [title, suffix, extra?] entries. */
interface Payload {
  b: string
  i: ([string, string] | [string, string, { s?: number; k?: string }])[]
}

/**
 * Where VLC's position goes, carried beside the playlist as `r=`: a StreamForest
 * profile (`/api/vlc-report` writes the row), or a Jellyfin user, whose server the
 * handler on the computer reaches itself, since no Cloudflare Function can.
 */
export type ReportTarget =
  | { k: 'sf'; p: string }
  | { k: 'jf'; u: string; t: string }

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
    i: items.map((i) => {
      const extra: { s?: number; k?: string } = {}
      if (i.start && i.start > 0) extra.s = Math.floor(i.start)
      if (i.id) extra.k = i.id
      return Object.keys(extra).length
        ? [i.title, i.url.slice(base.length), extra]
        : [i.title, i.url.slice(base.length)]
    }),
  }
  return toBase64Url(JSON.stringify(payload))
}

export function encodeReport(target: ReportTarget): string {
  return toBase64Url(JSON.stringify(target))
}

/** Reverse of `encodeReport`. Throws on anything it did not produce. */
export function decodeReport(token: string): ReportTarget {
  const r = JSON.parse(fromBase64Url(token)) as ReportTarget
  if (r?.k === 'sf' && typeof r.p === 'string' && r.p) return { k: 'sf', p: r.p }
  if (r?.k === 'jf' && typeof r.u === 'string' && typeof r.t === 'string' && /^[0-9a-f]+$/i.test(r.u) && /^\w+$/.test(r.t)) {
    return { k: 'jf', u: r.u, t: r.t }
  }
  throw new Error('malformed report target')
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
  return payload.i.map(([title, suffix, extra]) => {
    if (typeof title !== 'string' || typeof suffix !== 'string') {
      throw new Error('malformed playlist entry')
    }
    const url = payload.b + suffix
    // The endpoint hands this to a media player on someone's machine, so it
    // only ever emits the two schemes a stream can arrive over.
    if (!/^https?:\/\//i.test(url)) throw new Error('unsupported url scheme')
    const item: PlaylistItem = { title, url }
    if (extra && typeof extra.s === 'number' && extra.s > 0) item.start = Math.floor(extra.s)
    if (extra && typeof extra.k === 'string') item.id = extra.k
    return item
  })
}

/** An extended M3U — one `#EXTINF` per entry, which is what makes VLC show titles. */
export function buildM3u(items: PlaylistItem[]): string {
  const lines = ['#EXTM3U']
  for (const { title, url, start } of items) {
    // A newline in a title would fabricate a playlist line of its own.
    lines.push(`#EXTINF:-1,${title.replace(/[\r\n]+/g, ' ').trim()}`)
    // `start-time` is one of the options VLC marks safe, so it is honoured from a
    // playlist it fetched. Desktop VLC does; VLC for iOS also resumes a URL it
    // has played before by itself.
    if (start && start > 0) lines.push(`#EXTVLCOPT:start-time=${Math.floor(start)}`)
    lines.push(url)
  }
  return lines.join('\n') + '\n'
}

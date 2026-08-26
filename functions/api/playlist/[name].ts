// GET /api/playlist/<name>.m3u?d=<token> — serves a playlist VLC can fetch.
//
// The season's entries travel inside the token (see src/lib/vlcPlaylist.ts);
// nothing is stored here, so there is no state to expire and the same link keeps
// working for as long as the provider URLs do. The route is a dynamic segment
// purely so the filename VLC shows can be the show and season.
//
// This exists because neither VLC link scheme takes more than a single URL:
// `vlc-x-callback://…/stream?url=` on the phone and `vlc://` on the desktop both
// carry one MRL. Pointing that one MRL at an .m3u is what turns a deeplink into
// a whole season.
import { buildM3u, decodePlaylist } from '../../../src/lib/vlcPlaylist'

// The token is opaque input from whoever holds the link, so the decoder rejects
// anything that is not http(s) and the response is marked as a download that must
// not be sniffed — this origin never serves it as something a browser will run.
const HEADERS = {
  'Content-Type': 'audio/x-mpegurl; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  // The entries carry the provider's credentials in their URLs. Nothing caches this.
  'Cache-Control': 'no-store',
}

export function onRequestGet(context: {
  request: Request
  params: { name: string }
}): Response {
  const token = new URL(context.request.url).searchParams.get('d')
  if (!token) return new Response('Missing d parameter', { status: 400 })

  let m3u: string
  try {
    m3u = buildM3u(decodePlaylist(token))
  } catch {
    return new Response('Invalid playlist token', { status: 400 })
  }

  const name = (context.params.name || 'playlist.m3u').replace(/[^\w.-]+/g, '_')
  return new Response(m3u, {
    headers: { ...HEADERS, 'Content-Disposition': `attachment; filename="${name}"` },
  })
}

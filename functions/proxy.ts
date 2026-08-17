// Cloudflare Pages Function — proxies the M3U download to bypass CORS.
//
// This file, not functions/_worker.ts, is what actually serves /proxy. Pages
// advanced mode looks for a _worker.js in the *build output*; a _worker.ts under
// functions/ is not it, so that file has never run and the header claiming it
// replaces this routing is wrong. Anything meant to take effect belongs here.

interface KVNamespace {
  get(key: string, opts: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>
}
interface Env {
  M3U_CACHE?: KVNamespace
  /** Comma-separated hosts this proxy may fetch. Set as a Pages variable when the
   *  provider moves; the code carries the current one as a fallback. */
  PROXY_ALLOWED_HOSTS?: string
}

// Without a list here, a public URL on the open internet fetched anything for
// anyone and returned it with CORS wide open — an open relay on this account's
// quota. The transcode server has had the equivalent since it was written.
//
// The provider migrates (iptvworld.xyz → nsclient.xyz), so this is overridable.
// Use the hostname, never the bare IP: Cloudflare refuses to fetch a raw address
// from a Worker at all, answering "error code: 1003" before the request leaves.
const DEFAULT_ALLOWED_HOSTS = ['nsclient.xyz']

function hostAllowed(env: Env, url: URL): boolean {
  const configured = (env.PROXY_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean)
  const allowed = configured.length > 0 ? configured : DEFAULT_ALLOWED_HOSTS
  return allowed.some(h => url.hostname === h || url.hostname.endsWith('.' + h))
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
}

async function urlHash(url: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
  return Array.from(new Uint8Array(buf).slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const url = new URL(context.request.url)
  const target = url.searchParams.get('url')

  if (!target) {
    return new Response('Missing url parameter', { status: 400, headers: CORS })
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(target)
  } catch {
    return new Response('Invalid url parameter', { status: 400, headers: CORS })
  }

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return new Response('Only http/https allowed', { status: 400, headers: CORS })
  }
  if (!hostAllowed(context.env, targetUrl)) {
    return new Response(`Host not allowed: ${targetUrl.hostname}`, { status: 403, headers: CORS })
  }

  // The nightly Worker gzips the playlist into KV. Serving from there skips a
  // 60 MB transfer from the provider entirely; fetch() decompresses it for the
  // caller, so nothing downstream has to know. Until now this cache was written
  // every night and read by nobody, because the only reader lived in the file
  // Pages never ran.
  if (context.env.M3U_CACHE) {
    try {
      const cached = await context.env.M3U_CACHE.get(`m3u:${await urlHash(target)}`, { type: 'arrayBuffer' })
      if (cached) {
        return new Response(cached, {
          headers: {
            ...CORS,
            'Content-Type': 'application/x-mpegURL',
            'Content-Encoding': 'gzip',
            'Cache-Control': 'no-store',
            'X-M3U-Source': 'kv-cache',
          },
        })
      }
    } catch {
      // A cache miss must never be the reason a download fails.
    }
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StreamForest/1.0)',
      },
    })

    const headers = new Headers({
      ...CORS,
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
      'X-M3U-Source': 'upstream',
    })

    const contentLength = upstream.headers.get('Content-Length')
    if (contentLength) headers.set('Content-Length', contentLength)

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    })
  } catch (err) {
    return new Response(`Proxy error: ${String(err)}`, { status: 502, headers: CORS })
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' },
  })
}

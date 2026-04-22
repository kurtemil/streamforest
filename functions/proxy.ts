// Cloudflare Pages Function — proxies the M3U download to bypass CORS
export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url)
  const target = url.searchParams.get('url')

  if (!target) {
    return new Response('Missing url parameter', { status: 400 })
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(target)
  } catch {
    return new Response('Invalid url parameter', { status: 400 })
  }

  // Only allow http/https
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return new Response('Only http/https allowed', { status: 400 })
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StreamForest/1.0)',
      },
    })

    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
    })

    const contentLength = upstream.headers.get('Content-Length')
    if (contentLength) headers.set('Content-Length', contentLength)

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    })
  } catch (err) {
    return new Response(`Proxy error: ${String(err)}`, { status: 502 })
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  })
}

// Standalone Worker — nightly M3U prefetch.
//
// Pages can't run cron triggers, so this lives as a separate Worker. It mirrors
// `prefetchM3u` in functions/_worker.ts — KEEP THE TWO IN SYNC (same D1 query,
// same KV key scheme, same gzip + 48h TTL) so the Pages /proxy route serves what
// this writes. Reads the configured M3U URL from D1, gzip-compresses the playlist
// (~50 MB → ~5 MB), and stores it in KV.

interface D1PreparedStatement {
  bind(...v: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
}
interface D1Database {
  prepare(q: string): D1PreparedStatement
}
interface KVNamespace {
  put(key: string, value: ArrayBuffer | string, opts?: { expirationTtl?: number }): Promise<void>
}
interface Env {
  DB: D1Database
  M3U_CACHE: KVNamespace
}

// 8-byte SHA-256 prefix as hex — must match functions/_worker.ts urlHash().
async function urlHash(url: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
  return Array.from(new Uint8Array(buf).slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function prefetchM3u(env: Env): Promise<void> {
  try {
    const row = await env.DB.prepare(
      'SELECT value FROM user_preferences WHERE profile_id = ? AND key = ?'
    ).bind('_global', 'm3u_url').first<{ value: string }>()

    if (!row?.value) {
      console.log('[m3u-prefetch] No URL configured — skipping')
      return
    }

    const m3uUrl = row.value
    console.log('[m3u-prefetch] Fetching', m3uUrl.slice(0, 60), '…')

    const res = await fetch(m3uUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StreamForest/1.0)' },
    })
    if (!res.ok) {
      console.error('[m3u-prefetch] Upstream returned', res.status, res.statusText)
      return
    }

    // Stream through gzip — keeps peak memory near the compressed size (~5 MB)
    // rather than the full 50 MB plaintext body.
    const compressed = await new Response(
      res.body!.pipeThrough(new CompressionStream('gzip'))
    ).arrayBuffer()

    const key = `m3u:${await urlHash(m3uUrl)}`
    // 48-hour TTL so a missed cron doesn't leave the cache empty for a full day.
    await env.M3U_CACHE.put(key, compressed, { expirationTtl: 48 * 3600 })

    console.log(`[m3u-prefetch] Stored ${(compressed.byteLength / 1024).toFixed(0)} KB (compressed) under ${key}`)
  } catch (err) {
    console.error('[m3u-prefetch] Error:', err)
  }
}

export default {
  // Fires on the cron schedule in wrangler.toml.
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await prefetchM3u(env)
  },

  // Manual trigger for testing the deploy without waiting for the cron:
  //   curl https://streamforest-m3u-prefetch.<account>.workers.dev/__run
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname === '/__run') {
      await prefetchM3u(env)
      return new Response('m3u prefetch run complete\n')
    }
    return new Response('streamforest m3u-prefetch worker — cron 05:00 UTC\n')
  },
}

// ⚠️ THIS FILE DOES NOT RUN. Verified against production on 2026-08-17.
//
// Pages advanced mode looks for a _worker.js in the *build output directory*.
// A _worker.ts under functions/ is not that, so file-based routing stays in
// charge and functions/proxy.ts and functions/api/*.ts are what actually serve
// requests — the opposite of what this header used to claim.
//
// It was proved by adding a host allowlist here and watching /proxy keep
// fetching an arbitrary URL in production. Two things had therefore never
// worked: the KV cache read (the nightly prefetch was written every night and
// read by nobody) and this allowlist. Both now live in functions/proxy.ts.
//
// Kept because it is the more coherent implementation and worth adopting
// deliberately — by emitting it to dist/_worker.js at build time — rather than
// by editing it and assuming. Until then, change the file-based handlers.

// ── Types ─────────────────────────────────────────────────────────────────────

interface D1Database {
  prepare(q: string): D1PreparedStatement
  exec(q: string): Promise<unknown>
}
interface D1PreparedStatement {
  bind(...v: unknown[]): D1PreparedStatement
  run(): Promise<unknown>
  all(): Promise<{ results: Record<string, unknown>[] }>
  first<T = Record<string, unknown>>(): Promise<T | null>
}
interface KVNamespace {
  get(key: string, opts: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>
  put(key: string, value: ArrayBuffer | string, opts?: { expirationTtl?: number }): Promise<void>
}
interface Fetcher {
  fetch(req: Request): Promise<Response>
}
interface Env {
  DB: D1Database
  M3U_CACHE: KVNamespace
  ASSETS: Fetcher
  /** Comma-separated hosts /proxy may fetch. Set as a Pages variable when the
   *  provider moves; the code carries the current one as a fallback. */
  PROXY_ALLOWED_HOSTS?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
}
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' }

function corsOpts(): Response {
  return new Response(null, { headers: { ...CORS, 'Access-Control-Max-Age': '86400' } })
}

async function urlHash(url: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
  return Array.from(new Uint8Array(buf).slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── /proxy ────────────────────────────────────────────────────────────────────
// Checks KV for a gzip-compressed M3U cached by the nightly cron before
// falling back to a live fetch from the upstream provider.
// The browser Fetch API transparently decompresses Content-Encoding: gzip,
// so nothing in fetcher.ts needs to change.

// Hosts /proxy will fetch. The transcode server has carried a list like this
// since it was written; this handler had none, which made a public URL on the
// open internet fetch anything for anyone and return it with CORS wide open —
// an open relay running on someone else's Cloudflare quota.
//
// The provider migrates (iptvworld.xyz → nsclient.xyz → a bare IP), so this is
// read from a binding when one exists and falls back to the current host.
const DEFAULT_PROXY_HOSTS = ['45.12.1.27', 'nsclient.xyz']

function proxyHostAllowed(env: Env, url: URL): boolean {
  const configured = (env.PROXY_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean)
  const allowed = configured.length > 0 ? configured : DEFAULT_PROXY_HOSTS
  return allowed.some(h => url.hostname === h || url.hostname.endsWith('.' + h))
}

async function handleProxy(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return corsOpts()

  const target = new URL(req.url).searchParams.get('url')
  if (!target) return new Response('Missing url', { status: 400 })

  let targetUrl: URL
  try { targetUrl = new URL(target) } catch { return new Response('Invalid url', { status: 400 }) }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return new Response('Only http/https allowed', { status: 400 })
  }
  if (!proxyHostAllowed(env, targetUrl)) {
    return new Response(`Host not allowed: ${targetUrl.hostname}`, { status: 403, headers: CORS })
  }

  // Serve from KV cache when available — instant, no upstream hit needed
  if (env.M3U_CACHE) {
    const key = `m3u:${await urlHash(target)}`
    const cached = await env.M3U_CACHE.get(key, { type: 'arrayBuffer' })
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
  }

  // Fallback: live fetch from upstream (old behaviour)
  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StreamForest/1.0)' },
    })
    const headers = new Headers({
      ...CORS,
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
    })
    const cl = upstream.headers.get('Content-Length')
    if (cl) headers.set('Content-Length', cl)
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (err) {
    return new Response(`Proxy error: ${String(err)}`, { status: 502 })
  }
}

// ── /api/progress ─────────────────────────────────────────────────────────────

async function ensureProgressTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS watch_progress (
      profile_id   TEXT    NOT NULL,
      channel_id   TEXT    NOT NULL,
      position     REAL    NOT NULL,
      duration     REAL    NOT NULL,
      last_watched INTEGER NOT NULL,
      completed    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (profile_id, channel_id)
    )
  `).run()
}

async function handleProgress(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return corsOpts()
  if (!env.DB) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 503, headers: JSON_CORS })
  const url = new URL(req.url)
  try {
    await ensureProgressTable(env)
    if (req.method === 'GET') {
      const profileId = url.searchParams.get('profileId')
      if (!profileId) return new Response(JSON.stringify({ error: 'Missing profileId' }), { status: 400, headers: JSON_CORS })
      const result = await env.DB.prepare(
        'SELECT profile_id, channel_id, position, duration, last_watched, completed FROM watch_progress WHERE profile_id = ?'
      ).bind(profileId).all()
      const rows = (result.results ?? []).map(r => ({
        id: `${r.profile_id}:${r.channel_id}`,
        profileId: r.profile_id, channelId: r.channel_id,
        position: r.position, duration: r.duration,
        lastWatched: r.last_watched, completed: Boolean(r.completed),
      }))
      return new Response(JSON.stringify(rows), { headers: JSON_CORS })
    }
    if (req.method === 'PUT') {
      const b = await req.json() as {
        profileId: string; channelId: string; position: number
        duration: number; lastWatched: number; completed: boolean
      }
      await env.DB.prepare(`
        INSERT INTO watch_progress (profile_id, channel_id, position, duration, last_watched, completed)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (profile_id, channel_id) DO UPDATE SET
          position     = excluded.position,
          duration     = excluded.duration,
          last_watched = excluded.last_watched,
          completed    = excluded.completed
        WHERE excluded.last_watched >= watch_progress.last_watched
      `).bind(b.profileId, b.channelId, b.position, b.duration, b.lastWatched, b.completed ? 1 : 0).run()
      return new Response('{"ok":true}', { headers: JSON_CORS })
    }
    if (req.method === 'DELETE') {
      const profileId = url.searchParams.get('profileId')
      const channelId = url.searchParams.get('channelId')
      if (!profileId || !channelId) return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400, headers: JSON_CORS })
      await env.DB.prepare('DELETE FROM watch_progress WHERE profile_id = ? AND channel_id = ?')
        .bind(profileId, channelId).run()
      return new Response('{"ok":true}', { headers: JSON_CORS })
    }
    return new Response('Method not allowed', { status: 405, headers: JSON_CORS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: JSON_CORS })
  }
}

// ── /api/preferences ──────────────────────────────────────────────────────────

async function handlePreferences(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return corsOpts()
  const url = new URL(req.url)
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      profile_id TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, key)
    )
  `).run()
  if (req.method === 'GET') {
    const profileId = url.searchParams.get('profileId')
    if (!profileId) return new Response(JSON.stringify({ error: 'Missing profileId' }), { status: 400, headers: JSON_CORS })
    const rows = await env.DB.prepare(
      'SELECT key, value FROM user_preferences WHERE profile_id = ?'
    ).bind(profileId).all()
    const result: Record<string, string> = {}
    for (const row of rows.results) result[row.key as string] = row.value as string
    return new Response(JSON.stringify(result), { headers: JSON_CORS })
  }
  if (req.method === 'PUT') {
    const { profileId, key, value } = await req.json() as { profileId?: string; key?: string; value?: string }
    if (!profileId || !key || value === undefined) {
      return new Response(JSON.stringify({ error: 'Missing profileId, key, or value' }), { status: 400, headers: JSON_CORS })
    }
    await env.DB.prepare(
      'INSERT OR REPLACE INTO user_preferences (profile_id, key, value, updated_at) VALUES (?, ?, ?, ?)'
    ).bind(profileId, key, value, Date.now()).run()
    return new Response('{"ok":true}', { headers: JSON_CORS })
  }
  return new Response('Method not allowed', { status: 405, headers: JSON_CORS })
}

// ── /api/restrictions ─────────────────────────────────────────────────────────

async function handleRestrictions(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return corsOpts()
  if (!env.DB) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 503, headers: JSON_CORS })
  const url = new URL(req.url)
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS kid_restrictions (
        profile_id   TEXT PRIMARY KEY,
        restrictions TEXT NOT NULL DEFAULT '{}'
      )
    `).run()
    if (req.method === 'GET') {
      const profileId = url.searchParams.get('profileId')
      if (!profileId) return new Response(JSON.stringify({ error: 'Missing profileId' }), { status: 400, headers: JSON_CORS })
      const row = await env.DB.prepare(
        'SELECT restrictions FROM kid_restrictions WHERE profile_id = ?'
      ).bind(profileId).first<{ restrictions: string }>()
      return new Response(row?.restrictions ?? '{"movie":[],"series":[],"live":[]}', { headers: JSON_CORS })
    }
    if (req.method === 'PUT') {
      const b = await req.json() as { profileId: string; movie: string[]; series: string[]; live: string[] }
      const json = JSON.stringify({ movie: b.movie, series: b.series, live: b.live })
      await env.DB.prepare(`
        INSERT INTO kid_restrictions (profile_id, restrictions) VALUES (?, ?)
        ON CONFLICT (profile_id) DO UPDATE SET restrictions = excluded.restrictions
      `).bind(b.profileId, json).run()
      return new Response('{"ok":true}', { headers: JSON_CORS })
    }
    return new Response('Method not allowed', { status: 405, headers: JSON_CORS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: JSON_CORS })
  }
}

// ── /api/watchlater ───────────────────────────────────────────────────────────

async function handleWatchLater(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return corsOpts()
  if (!env.DB) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 503, headers: JSON_CORS })
  const url = new URL(req.url)
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS watch_later (
        profile_id TEXT    NOT NULL,
        content_id TEXT    NOT NULL,
        kind       TEXT    NOT NULL,
        added_at   INTEGER NOT NULL,
        PRIMARY KEY (profile_id, content_id)
      )
    `).run()
    if (req.method === 'GET') {
      const profileId = url.searchParams.get('profileId')
      if (!profileId) return new Response(JSON.stringify({ error: 'Missing profileId' }), { status: 400, headers: JSON_CORS })
      const result = await env.DB.prepare(
        'SELECT profile_id, content_id, kind, added_at FROM watch_later WHERE profile_id = ? ORDER BY added_at DESC'
      ).bind(profileId).all()
      const rows = (result.results ?? []).map(r => ({
        id: `${r.profile_id}:${r.content_id}`,
        profileId: r.profile_id, contentId: r.content_id,
        kind: r.kind, addedAt: r.added_at,
      }))
      return new Response(JSON.stringify(rows), { headers: JSON_CORS })
    }
    if (req.method === 'PUT') {
      const b = await req.json() as { profileId: string; contentId: string; kind: string; addedAt: number }
      await env.DB.prepare(`
        INSERT INTO watch_later (profile_id, content_id, kind, added_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (profile_id, content_id) DO UPDATE SET kind = excluded.kind, added_at = excluded.added_at
      `).bind(b.profileId, b.contentId, b.kind, b.addedAt).run()
      return new Response('{"ok":true}', { headers: JSON_CORS })
    }
    if (req.method === 'DELETE') {
      const profileId = url.searchParams.get('profileId')
      const contentId = url.searchParams.get('contentId')
      if (!profileId || !contentId) return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400, headers: JSON_CORS })
      await env.DB.prepare('DELETE FROM watch_later WHERE profile_id = ? AND content_id = ?')
        .bind(profileId, contentId).run()
      return new Response('{"ok":true}', { headers: JSON_CORS })
    }
    return new Response('Method not allowed', { status: 405, headers: JSON_CORS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: JSON_CORS })
  }
}

// ── /api/exclusions ───────────────────────────────────────────────────────────

async function handleExclusions(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return corsOpts()
  if (!env.DB) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 503, headers: JSON_CORS })
  const url = new URL(req.url)
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS group_exclusions (
        profile_id TEXT PRIMARY KEY,
        movie      TEXT NOT NULL DEFAULT '[]',
        series     TEXT NOT NULL DEFAULT '[]',
        live       TEXT NOT NULL DEFAULT '[]'
      )
    `).run()
    if (req.method === 'GET') {
      const profileId = url.searchParams.get('profileId')
      if (!profileId) return new Response(JSON.stringify({ error: 'Missing profileId' }), { status: 400, headers: JSON_CORS })
      const row = await env.DB.prepare(
        'SELECT movie, series, live FROM group_exclusions WHERE profile_id = ?'
      ).bind(profileId).first()
      const result = {
        movie:  JSON.parse((row?.movie  as string | null) ?? '[]') as string[],
        series: JSON.parse((row?.series as string | null) ?? '[]') as string[],
        live:   JSON.parse((row?.live   as string | null) ?? '[]') as string[],
      }
      return new Response(JSON.stringify(result), { headers: JSON_CORS })
    }
    if (req.method === 'PUT') {
      const b = await req.json() as { profileId: string; movie: string[]; series: string[]; live: string[] }
      await env.DB.prepare(`
        INSERT INTO group_exclusions (profile_id, movie, series, live) VALUES (?, ?, ?, ?)
        ON CONFLICT (profile_id) DO UPDATE SET
          movie = excluded.movie, series = excluded.series, live = excluded.live
      `).bind(
        b.profileId,
        JSON.stringify(b.movie ?? []),
        JSON.stringify(b.series ?? []),
        JSON.stringify(b.live ?? []),
      ).run()
      return new Response('{"ok":true}', { headers: JSON_CORS })
    }
    return new Response('Method not allowed', { status: 405, headers: JSON_CORS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: JSON_CORS })
  }
}

// ── /api/pin ──────────────────────────────────────────────────────────────────

async function handlePin(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return corsOpts()
  if (!env.DB) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 503, headers: JSON_CORS })
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS profile_pins (
        profile_id TEXT PRIMARY KEY,
        pin_hash   TEXT NOT NULL
      )
    `).run()
    if (req.method === 'POST') {
      const { profile_id, pin } = await req.json() as { profile_id: string; pin: string }
      if (!profile_id || !pin) return new Response('{"ok":false}', { status: 400, headers: JSON_CORS })
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin))
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
      const row = await env.DB.prepare(
        'SELECT pin_hash FROM profile_pins WHERE profile_id = ?'
      ).bind(profile_id).first<{ pin_hash: string }>()
      return new Response(JSON.stringify({ ok: row?.pin_hash === hash }), { headers: JSON_CORS })
    }
    return new Response('Method not allowed', { status: 405, headers: JSON_CORS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: JSON_CORS })
  }
}

// ── Scheduled: nightly M3U prefetch ──────────────────────────────────────────
// Runs at 05:00 UTC (06:00 CET / 07:00 CEST).
// Reads the M3U URL from D1, fetches it from the upstream provider, gzip-
// compresses it (50 MB → ~5 MB), and stores it in KV with a 48-hour TTL.
// Next day the proxy serves from KV — no upstream hit, instant for all devices.

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

    // Stream through gzip compression — keeps peak memory near the compressed
    // size (~5 MB) rather than the full 50 MB plaintext body.
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

// ── Entry points ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/proxy')            return handleProxy(request, env)
    if (path === '/api/progress')     return handleProgress(request, env)
    if (path === '/api/preferences')  return handlePreferences(request, env)
    if (path === '/api/restrictions') return handleRestrictions(request, env)
    if (path === '/api/watchlater')   return handleWatchLater(request, env)
    if (path === '/api/exclusions')   return handleExclusions(request, env)
    if (path === '/api/pin')          return handlePin(request, env)
    return env.ASSETS.fetch(request)
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    await prefetchM3u(env)
  },
}

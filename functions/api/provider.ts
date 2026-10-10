// Moves the IPTV provider from inside the app.
//
// The app reaches the provider through iptv.krutofv.se, our DNS-only name for its
// IP (src/lib/provider.ts says why). When the provider moves, the admin pastes the
// new playlist URL into Settings and Settings posts it here. This points the record
// at the new address and stores m3u_url on our name — no terminal, no dashboard,
// from a phone if need be.
//
//   GET  /api/provider                     → { host, target, ips, port, m3uHost }
//   POST /api/provider { url, ips, pin }   → { ok, target, ips, m3uUrl, check }
//
// `ips` are the provider's servers in the admin's order (up to four). The record
// points at one of them; the transcode server polls GET and moves the record to
// the next when the one in use stops answering (transcode-proxy/provider.mjs).
//
// Because whatever the record points at becomes an allowed host for the transcode
// server, moving it is guarded three ways:
//   - the admin profile's PIN, checked here rather than trusted from the client;
//   - five wrong PINs in an hour lock the endpoint for the rest of that hour;
//   - only public IPv4 addresses are accepted, so the record can never be aimed
//     into the home network (the transcode server would then fetch from it).
//
// Needs the Pages secret CF_DNS_TOKEN: Cloudflare's "Edit zone DNS" template,
// limited to krutofv.se.

interface D1Database {
  prepare(query: string): D1PreparedStatement
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  run(): Promise<unknown>
  first<T = Record<string, unknown>>(): Promise<T | null>
}
interface Env {
  DB: D1Database
  CF_DNS_TOKEN?: string
}

const PROVIDER_HOST = 'iptv.krutofv.se' // keep in step with src/lib/provider.ts
const ZONE_ID = 'e6588d30dac73e39ada17f6eddc943e3' // krutofv.se
const ADMIN_PROFILE = 'elof' // the one profile with role 'admin' in profileStore
const MAX_FAILURES_PER_HOUR = 5
const MAX_IPS = 4

const HEADERS = { 'Content-Type': 'application/json' }

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS })
}

/** Errors carry a code the client translates; `detail` is for the log only. */
function fail(code: string, status: number, detail?: string): Response {
  return reply({ ok: false, code, ...(detail ? { detail } : {}) }, status)
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function isIPv4(s: string): boolean {
  return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) &&
    s.split('.').every((p) => Number(p) <= 255)
}

/** Anything that is not a routable public address: private, CGNAT/Tailscale, loopback… */
function isPublicIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 168 || b === 0)) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  return true
}

/** The provider's address as an IP — a hostname is resolved once, here. */
async function toIp(host: string): Promise<string | null> {
  if (isIPv4(host)) return host
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
    headers: { Accept: 'application/dns-json' },
  })
  if (!res.ok) return null
  const json = (await res.json()) as { Answer?: { type: number; data: string }[] }
  return json.Answer?.find((a) => a.type === 1)?.data ?? null
}

async function cf<T>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.CF_DNS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json()) as { success: boolean; result: T; errors: unknown }
  if (!json.success) throw new Error(`Cloudflare ${method} ${path}: ${JSON.stringify(json.errors)}`)
  return json.result
}

type DnsRecord = { id: string; type: string; content: string }

async function currentRecords(env: Env): Promise<DnsRecord[]> {
  return cf<DnsRecord[]>(env, 'GET', `/dns_records?name=${PROVIDER_HOST}`)
}

async function pointAt(env: Env, ip: string): Promise<void> {
  const record = {
    type: 'A', name: PROVIDER_HOST, content: ip, ttl: 60, proxied: false,
    comment: 'IPTV provider. Moved from StreamForest Settings (functions/api/provider.ts)',
  }
  const existing = await currentRecords(env)
  // A CNAME cannot sit beside an A record, and a type change cannot be an edit.
  for (const r of existing) if (r.type !== 'A') await cf(env, 'DELETE', `/dns_records/${r.id}`)
  const a = existing.find((r) => r.type === 'A')
  if (a) await cf(env, 'PUT', `/dns_records/${a.id}`, record)
  else await cf(env, 'POST', '/dns_records', record)
}

async function ensureTables(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS provider_attempts (
      at INTEGER NOT NULL
    )
  `).run()
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      profile_id TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, key)
    )
  `).run()
}

/** Does the provider answer on our name? Reported, never acted on. */
async function check(m3uUrl: URL): Promise<{ answers: boolean; status?: string; expires?: string }> {
  const api = new URL('/player_api.php', m3uUrl.origin)
  api.searchParams.set('username', m3uUrl.searchParams.get('username') ?? '')
  api.searchParams.set('password', m3uUrl.searchParams.get('password') ?? '')
  try {
    const res = await fetch(api.toString(), { signal: AbortSignal.timeout(8000) })
    const info = (await res.json()) as { user_info?: { status?: string; exp_date?: string } }
    const exp = info.user_info?.exp_date
    return {
      answers: true,
      status: info.user_info?.status,
      ...(exp ? { expires: new Date(Number(exp) * 1000).toISOString().slice(0, 10) } : {}),
    }
  } catch {
    return { answers: false }
  }
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context
  if (!env.DB) return fail('noDb', 503)
  await ensureTables(env)

  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      "SELECT value FROM user_preferences WHERE profile_id = '_global' AND key = 'm3u_url'",
    ).first<{ value: string }>()
    let m3uHost: string | null = null
    let port = 80
    try {
      const u = row ? new URL(row.value) : null
      m3uHost = u?.host ?? null
      port = Number(u?.port) || 80
    } catch { /* not a URL */ }
    let target: string | null = null
    if (env.CF_DNS_TOKEN) {
      try { target = (await currentRecords(env))[0]?.content ?? null } catch { /* reported as unknown */ }
    }
    // The transcode server polls this for the IPs to fail over between.
    const ips = await storedIps(env)
    return reply({ host: PROVIDER_HOST, configured: Boolean(env.CF_DNS_TOKEN), target, ips, port, m3uHost })
  }

  if (request.method !== 'POST') return fail('method', 405)
  if (!env.CF_DNS_TOKEN) return fail('noToken', 503)

  const hourAgo = Date.now() - 3600_000
  const failures = await env.DB.prepare('SELECT COUNT(*) AS n FROM provider_attempts WHERE at > ?')
    .bind(hourAgo).first<{ n: number }>()
  if ((failures?.n ?? 0) >= MAX_FAILURES_PER_HOUR) return fail('locked', 429)

  const { url, ips: givenIps, pin } = (await request.json().catch(() => ({}))) as {
    url?: string; ips?: unknown; pin?: string
  }

  const pinRow = await env.DB.prepare('SELECT pin_hash FROM profile_pins WHERE profile_id = ?')
    .bind(ADMIN_PROFILE).first<{ pin_hash: string }>()
  if (!pin || !pinRow || pinRow.pin_hash !== (await sha256(pin))) {
    await env.DB.prepare('INSERT INTO provider_attempts (at) VALUES (?)').bind(Date.now()).run()
    await env.DB.prepare('DELETE FROM provider_attempts WHERE at < ?').bind(hourAgo).run()
    return fail('pin', 403)
  }

  let given: URL
  try {
    given = new URL((url ?? '').trim())
  } catch {
    return fail('badUrl', 400)
  }
  // Plain http only: the provider's certificate names its own domain, never ours,
  // so an https URL moved onto iptv.krutofv.se could not complete a handshake.
  if (given.protocol === 'https:') return fail('https', 400)
  if (given.protocol !== 'http:') return fail('badUrl', 400)

  // The admin's IPs, in order. An address in the pasted URL goes first if it is
  // not already listed, so pasting the provider's URL alone still works.
  const ips: string[] = []
  for (const raw of Array.isArray(givenIps) ? givenIps : []) {
    const ip = String(raw).trim()
    if (!ip) continue
    if (!isIPv4(ip)) return fail('badIp', 400, ip)
    if (!isPublicIPv4(ip)) return fail('privateAddress', 400, ip)
    if (!ips.includes(ip)) ips.push(ip)
  }
  if (given.hostname !== PROVIDER_HOST) {
    const fromUrl = await toIp(given.hostname)
    if (!fromUrl) return fail('noAddress', 400, given.hostname)
    if (!isPublicIPv4(fromUrl)) return fail('privateAddress', 400, fromUrl)
    if (!ips.includes(fromUrl)) ips.unshift(fromUrl)
  }
  if (ips.length === 0) return fail('noIps', 400)
  if (ips.length > MAX_IPS) return fail('tooManyIps', 400, String(MAX_IPS))

  // Leave the record alone if it already points at a listed IP: the transcode
  // server may have failed over to it, and moving it back would undo that.
  let target: string | null
  try {
    const current = (await currentRecords(env)).find((r) => r.type === 'A')?.content ?? null
    target = current && ips.includes(current) ? current : ips[0]
    if (target !== current) await pointAt(env, target)
  } catch (e) {
    return fail('dnsFailed', 502, String(e))
  }

  const stored = new URL(given.toString())
  stored.hostname = PROVIDER_HOST
  const save = 'INSERT OR REPLACE INTO user_preferences (profile_id, key, value, updated_at) VALUES (?, ?, ?, ?)'
  await env.DB.prepare(save).bind('_global', 'm3u_url', stored.toString(), Date.now()).run()
  await env.DB.prepare(save).bind('_global', 'provider_ips', JSON.stringify(ips), Date.now()).run()

  return reply({ ok: true, target, ips, m3uUrl: stored.toString(), check: await check(stored) })
}

async function storedIps(env: Env): Promise<string[]> {
  const row = await env.DB.prepare(
    "SELECT value FROM user_preferences WHERE profile_id = '_global' AND key = 'provider_ips'",
  ).first<{ value: string }>()
  try {
    const ips = row ? JSON.parse(row.value) : []
    return Array.isArray(ips) ? ips.filter((ip): ip is string => typeof ip === 'string') : []
  } catch {
    return []
  }
}

// Fail-over between the IPTV provider's addresses.
//
// The provider has several servers (IPs). The app reaches whichever one we use as
// iptv.krutofv.se, a DNS-only record (src/lib/provider.ts). The admin lists the
// IPs in Settings, in order; Pages stores them and serves them at /api/provider.
//
// This runs here because this is the one always-on part that can reach a bare IP
// (Cloudflare refuses to) and the part that streams everything. Every ten minutes,
// and at once when a playback fails, it asks the active IP for any HTTP answer.
// That is one small request: the others are only tried when the active one fails,
// and a failed probe already triggers a check, so polling more often buys nothing. When that fails it tries the others in
// the admin's order, and the first that answers becomes active:
//   - this server uses it at once, by connecting to the IP instead of the name;
//   - the DNS record is repointed, so the playlist download and VLC follow within
//     the record's TTL (60 s).
// It does not move back when an earlier IP recovers: moving costs a blip, and
// staying put on a working server costs nothing.

const CHECK_EVERY_MS = 10 * 60_000
const PROBE_TIMEOUT_MS = 5_000
// When nothing answers (a block on the home IP looks exactly like that), knocking
// on all four every round is more of what got the address blocked. Then only the
// active one is tried each round, and the rest at most this often.
const FULL_SCAN_WHEN_DOWN_MS = 30 * 60_000

/**
 * @param {object} o
 * @param {string} o.host            our name for the provider, e.g. iptv.krutofv.se
 * @param {string} o.configUrl       GET → { ips: string[], port: number, target: string|null }
 * @param {string} [o.zoneId]        Cloudflare zone of `host`
 * @param {string} [o.token]         Cloudflare token with DNS edit; without it, DNS is not moved
 * @param {typeof fetch} [o.fetchImpl]
 * @param {(line: string) => void} [o.log]
 * @param {() => number} [o.now]
 */
export function createProviderFailover(o) {
  const fetchImpl = o.fetchImpl ?? fetch
  const log = o.log ?? ((line) => process.stderr.write(line + '\n'))
  const now = o.now ?? Date.now

  let ips = []
  let port = 80
  let active = null
  let lastSwitch = null
  /** @type {Record<string, { ok: boolean, at: number, ms: number }>} */
  const checks = {}
  let running = null
  let allDownSince = null
  let lastFullScan = 0
  let timer = null

  async function loadConfig() {
    try {
      const res = await fetchImpl(o.configUrl, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return
      const cfg = await res.json()
      if (Array.isArray(cfg.ips)) ips = cfg.ips.filter((ip) => typeof ip === 'string')
      if (Number(cfg.port) > 0) port = Number(cfg.port)
      // The record is the truth when this server starts or the admin moved it.
      if (cfg.target && (active === null || !ips.includes(active))) active = cfg.target
    } catch {
      // Unreachable config keeps the last known list; checks go on.
    }
  }

  /** Any HTTP answer at all means the server is up. Refused or silent means not. */
  async function alive(ip) {
    const started = now()
    let ok = false
    try {
      await fetchImpl(`http://${ip}:${port}/`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      ok = true
    } catch {
      ok = false
    }
    checks[ip] = { ok, at: now(), ms: now() - started }
    return ok
  }

  async function pointDns(ip) {
    if (!o.token || !o.zoneId) return false
    const api = `https://api.cloudflare.com/client/v4/zones/${o.zoneId}/dns_records`
    const headers = { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' }
    const list = await (await fetchImpl(`${api}?name=${o.host}&type=A`, { headers })).json()
    const record = {
      type: 'A', name: o.host, content: ip, ttl: 60, proxied: false,
      comment: 'IPTV provider. Moved automatically by transcode-proxy/provider.mjs',
    }
    const existing = list.result?.[0]
    const res = await fetchImpl(existing ? `${api}/${existing.id}` : api, {
      method: existing ? 'PUT' : 'POST', headers, body: JSON.stringify(record),
    })
    return (await res.json()).success === true
  }

  async function checkOnce() {
    await loadConfig()
    if (ips.length === 0) return
    if (active && ips.includes(active) && (await alive(active))) { allDownSince = null; return }
    if (allDownSince !== null && now() - lastFullScan < FULL_SCAN_WHEN_DOWN_MS) return
    lastFullScan = now()

    for (const ip of ips) {
      if (ip === active) continue
      if (await alive(ip)) {
        const from = active
        active = ip
        let dns = false
        try { dns = await pointDns(ip) } catch { dns = false }
        allDownSince = null
        lastSwitch = { from, to: ip, at: now(), dns }
        log(`[provider] ${from ?? '—'} did not answer; switched to ${ip}${dns ? '' : ' (DNS NOT moved)'}`)
        return
      }
    }
    allDownSince ??= now()
    log(`[provider] no address answers: ${ips.join(', ')}`)
  }

  /** Run a check now, unless one is already under way. */
  function check() {
    running ??= checkOnce().finally(() => { running = null })
    return running
  }

  return {
    start() {
      check()
      timer = setInterval(check, CHECK_EVERY_MS)
      timer.unref?.()
    },
    stop() { clearInterval(timer) },
    check,
    /** A connection to the provider failed: look again now rather than at the next round. */
    reportFailure() { check() },
    /** The URL this server should connect to: our name swapped for the active IP. */
    resolve(url) {
      if (!active) return url
      try {
        const u = new URL(url)
        if (u.hostname !== o.host) return url
        u.hostname = active
        return u.toString()
      } catch {
        return url
      }
    },
    status() {
      return { host: o.host, port, active, lastSwitch, ips, checks, allDownSince, dnsConfigured: Boolean(o.token) }
    },
  }
}

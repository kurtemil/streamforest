// The /api/provider Function, run against a fake D1 and a fake Cloudflare.
// It lives here rather than beside the Function because every file under
// functions/ becomes a route.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../../functions/api/provider'

const PIN = '4711'

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Just enough D1 for the statements the Function runs. */
function fakeDb(pinHash: string) {
  const attempts: number[] = []
  const prefs = new Map<string, string>()
  const db = {
    prepare(sql: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt },
        async run() {
          if (sql.startsWith('INSERT INTO provider_attempts')) attempts.push(args[0] as number)
          if (sql.startsWith('INSERT OR REPLACE INTO user_preferences')) prefs.set(`${args[0]}:${args[1]}`, args[2] as string)
          return {}
        },
        async first() {
          if (sql.includes('COUNT(*)')) return { n: attempts.filter((t) => t > (args[0] as number)).length }
          if (sql.includes('FROM profile_pins')) return args[0] === 'elof' ? { pin_hash: pinHash } : null
          for (const key of ['m3u_url', 'provider_ips']) {
            if (sql.includes(`key = '${key}'`)) {
              const v = prefs.get(`_global:${key}`)
              return v ? { value: v } : null
            }
          }
          return null
        },
      }
      return stmt
    },
  }
  return { db, attempts, prefs }
}

let dnsWrites: { method: string; body: Record<string, unknown> }[]
/** What the A record points at before the request. */
let currentTarget = '45.12.1.27'

function fakeCloudflare() {
  dnsWrites = []
  currentTarget = '45.12.1.27'
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown) => new Response(JSON.stringify(body))
    if (url.startsWith('https://cloudflare-dns.com/')) {
      return json({ Answer: url.includes('name=home.example') ? [{ type: 1, data: '192.168.1.155' }]
        : url.includes('name=new-panel.example') ? [{ type: 1, data: '198.51.100.20' }] : [] })
    }
    if (url.startsWith('https://api.cloudflare.com/')) {
      const method = init?.method ?? 'GET'
      if (method === 'GET') return json({ success: true, result: [{ id: 'r1', type: 'A', content: currentTarget }] })
      dnsWrites.push({ method, body: JSON.parse(String(init?.body ?? '{}')) })
      return json({ success: true, result: {} })
    }
    if (url.includes('/player_api.php')) {
      return json({ user_info: { status: 'Active', exp_date: '1830297600' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }))
}

async function post(env: unknown, body: unknown) {
  const req = new Request('https://streamforest.krutofv.se/api/provider', {
    method: 'POST', body: JSON.stringify(body),
  })
  const res = await onRequest({ request: req, env: env as never })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const NEW = 'http://198.51.100.7:8080/get.php?username=u1&password=p1&type=m3u_plus'

describe('/api/provider', () => {
  let state: ReturnType<typeof fakeDb>
  let env: Record<string, unknown>

  beforeEach(async () => {
    state = fakeDb(await sha256(PIN))
    env = { DB: state.db, CF_DNS_TOKEN: 'token' }
    fakeCloudflare()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('points the record at the new IP and stores the URL on our name', async () => {
    const r = await post(env, { url: NEW, pin: PIN })
    expect(r.status).toBe(200)
    expect(r.body.target).toBe('198.51.100.7')
    expect(r.body.m3uUrl).toBe('http://iptv.krutofv.se:8080/get.php?username=u1&password=p1&type=m3u_plus')
    expect(dnsWrites).toEqual([expect.objectContaining({
      method: 'PUT', body: expect.objectContaining({ type: 'A', content: '198.51.100.7', proxied: false }),
    })])
    expect(state.prefs.get('_global:m3u_url')).toBe(r.body.m3uUrl)
    expect(r.body.check).toEqual({ answers: true, status: 'Active', expires: '2028-01-01' })
  })

  it('resolves a provider hostname to its IP once, and points at that', async () => {
    const r = await post(env, { url: 'http://new-panel.example:2095/get.php?username=u1&password=p1', pin: PIN })
    expect(r.body.target).toBe('198.51.100.20')
    expect(dnsWrites[0].body.content).toBe('198.51.100.20')
  })

  it('refuses a wrong PIN, records it, and locks after five in an hour', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post(env, { url: NEW, pin: '0000' })).body.code).toBe('pin')
    }
    expect(state.attempts).toHaveLength(5)
    const locked = await post(env, { url: NEW, pin: PIN })
    expect(locked.status).toBe(429)
    expect(locked.body.code).toBe('locked')
    expect(dnsWrites).toHaveLength(0)
  })

  it('never points the record into a private network', async () => {
    for (const url of [
      'http://192.168.1.155:8123/get.php?username=u1&password=p1',
      'http://100.102.121.4:8096/get.php?username=u1&password=p1',
      'http://127.0.0.1:8787/get.php?username=u1&password=p1',
      'http://home.example:80/get.php?username=u1&password=p1', // a public name for a private IP
    ]) {
      const r = await post(env, { url, pin: PIN })
      expect(r.body.code, url).toBe('privateAddress')
    }
    expect(dnsWrites).toHaveLength(0)
  })

  it('stores the admin’s IPs in order and points the record at the first', async () => {
    const onOurName = 'http://iptv.krutofv.se:8080/get.php?username=u1&password=p1'
    const r = await post(env, { url: onOurName, ips: ['198.51.100.1', ' 198.51.100.2 ', '', '198.51.100.1'], pin: PIN })
    expect(r.body.ips).toEqual(['198.51.100.1', '198.51.100.2'])
    expect(r.body.target).toBe('198.51.100.1')
    expect(dnsWrites[0].body.content).toBe('198.51.100.1')
    expect(JSON.parse(state.prefs.get('_global:provider_ips')!)).toEqual(['198.51.100.1', '198.51.100.2'])
  })

  it('puts an address from the pasted URL first when it is not listed', async () => {
    const r = await post(env, { url: NEW, ips: ['198.51.100.1'], pin: PIN })
    expect(r.body.ips).toEqual(['198.51.100.7', '198.51.100.1'])
  })

  it('leaves the record alone when it already points at a listed IP — a fail-over may have put it there', async () => {
    currentTarget = '198.51.100.2'
    const onOurName = 'http://iptv.krutofv.se:8080/get.php?username=u1&password=p1'
    const r = await post(env, { url: onOurName, ips: ['198.51.100.1', '198.51.100.2'], pin: PIN })
    expect(r.body.target).toBe('198.51.100.2')
    expect(dnsWrites).toHaveLength(0)
  })

  it('refuses a bad, private, missing or fifth IP before touching anything', async () => {
    const onOurName = 'http://iptv.krutofv.se:8080/get.php?username=u1&password=p1'
    expect((await post(env, { url: onOurName, ips: ['nsclient.xyz'], pin: PIN })).body.code).toBe('badIp')
    expect((await post(env, { url: onOurName, ips: ['198.51.100.1', '10.0.0.5'], pin: PIN })).body.code).toBe('privateAddress')
    expect((await post(env, { url: onOurName, ips: [], pin: PIN })).body.code).toBe('noIps')
    const five = ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4', '198.51.100.5']
    expect((await post(env, { url: onOurName, ips: five, pin: PIN })).body.code).toBe('tooManyIps')
    expect(dnsWrites).toHaveLength(0)
    expect(state.prefs.size).toBe(0)
  })

  it('serves the IPs and the port to the transcode server', async () => {
    await post(env, { url: NEW, ips: ['198.51.100.1'], pin: PIN })
    const res = await onRequest({ request: new Request('https://x/api/provider'), env: env as never })
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ host: 'iptv.krutofv.se', ips: ['198.51.100.7', '198.51.100.1'], port: 8080, configured: true })
  })

  it('refuses https, nonsense, and a missing Cloudflare key', async () => {
    expect((await post(env, { url: NEW.replace('http:', 'https:'), pin: PIN })).body.code).toBe('https')
    expect((await post(env, { url: 'not a url', pin: PIN })).body.code).toBe('badUrl')
    const noKey = await post({ DB: state.db }, { url: NEW, pin: PIN })
    expect(noKey.status).toBe(503)
    expect(noKey.body.code).toBe('noToken')
    expect(dnsWrites).toHaveLength(0)
  })
})

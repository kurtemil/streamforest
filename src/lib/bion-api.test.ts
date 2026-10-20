// /api/bion against a small in-memory D1, and the rules the phone and the kiosk
// read the answers by. Lives here because every file in functions/ is a route.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanCommand, COMMAND_TTL_MS, onRequest } from '../../functions/api/bion'
import { isBionActive, STATUS_FRESH_MS } from '@/services/bion'
import { ALIVE_MS, bionAlive, bionVisible, channelTitle, useBionStore } from '@/stores/bionStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useHomeLibraryStore } from '@/stores/homeLibraryStore'
import { useProfileStore } from '@/stores/profileStore'
import type { Channel } from '@/types'
import { seekTarget } from '@/lib/playerBridge'

/** Just enough SQL for the statements bion.ts makes. */
function memoryDb() {
  const commands: { seq: number; device: string; body: string; created: number }[] = []
  const status = new Map<string, { body: string; updated: number }>()
  let seq = 0
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    async run() {
      if (sql.startsWith('INSERT INTO bion_commands')) {
        commands.push({ seq: ++seq, device: String(args[0]), body: String(args[1]), created: Number(args[2]) })
      } else if (sql.startsWith('DELETE FROM bion_commands')) {
        for (let i = commands.length - 1; i >= 0; i--) if (commands[i].created < Number(args[0])) commands.splice(i, 1)
      } else if (sql.trim().startsWith('INSERT INTO bion_status')) {
        status.set(String(args[0]), { body: String(args[1]), updated: Number(args[2]) })
      }
      return {}
    },
    async all() {
      if (sql.startsWith('SELECT MAX(seq)')) {
        const mine = commands.filter((c) => c.device === args[0])
        return { results: [{ latest: mine.length ? Math.max(...mine.map((c) => c.seq)) : null }] }
      }
      if (sql.startsWith('SELECT body, updated FROM bion_status')) {
        const row = status.get(String(args[0]))
        return { results: row ? [row] : [] }
      }
      if (sql.startsWith('SELECT seq, body, created FROM bion_commands')) {
        const [device, after, since] = args as [string, number, number]
        return { results: commands.filter((c) => c.device === device && c.seq > after && c.created > since) }
      }
      return { results: [] }
    },
  })
  return { commands, status, db: { prepare: (sql: string) => stmt(sql) } }
}

const call = async (env: unknown, method: string, query = '', body?: unknown) => {
  const res = await onRequest({
    request: new Request(`https://x/api/bion${query}`, { method, body: body ? JSON.stringify(body) : undefined }),
    env: env as never,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

describe('/api/bion', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('hands the kiosk what the phone sent, once, in order', async () => {
    const m = memoryDb()
    const env = { DB: m.db }
    const start = await call(env, 'GET', '?device=bion')
    expect(start.body.commands).toEqual([])
    const cursor = start.body.latest

    await call(env, 'POST', '', { device: 'bion', command: { type: 'play', profileId: 'elof', itemId: 'abc' } })
    await call(env, 'POST', '', { device: 'bion', command: { type: 'pause' } })
    const first = await call(env, 'GET', `?device=bion&after=${cursor}`)
    expect(first.body.commands.map((c: { type: string }) => c.type)).toEqual(['play', 'pause'])
    // A play without a source is a home film: what the first phones sent.
    expect(first.body.commands[0]).toMatchObject({ source: 'home', profileId: 'elof', itemId: 'abc', fromStart: false })

    const again = await call(env, 'GET', `?device=bion&after=${first.body.latest}`)
    expect(again.body.commands).toEqual([])
  })

  it('does not replay to a kiosk that starts up after the command was sent', async () => {
    const m = memoryDb()
    const env = { DB: m.db }
    await call(env, 'POST', '', { device: 'bion', command: { type: 'play', profileId: 'elof', itemId: 'old' } })
    // A kiosk coming up asks without `after` and gets only the cursor.
    const start = await call(env, 'GET', '?device=bion')
    expect(start.body.commands).toEqual([])
    const next = await call(env, 'GET', `?device=bion&after=${start.body.latest}`)
    expect(next.body.commands).toEqual([])
  })

  it('drops commands older than a minute', async () => {
    const m = memoryDb()
    m.commands.push({ seq: 1, device: 'bion', body: JSON.stringify({ type: 'stop' }), created: Date.now() - COMMAND_TTL_MS - 1 })
    const res = await call({ DB: m.db }, 'GET', '?device=bion&after=0')
    expect(res.body.commands).toEqual([])
  })

  it('refuses what the kiosk would not understand', async () => {
    const env = { DB: memoryDb().db }
    expect((await call(env, 'POST', '', { device: 'bion', command: { type: 'rm -rf' } })).status).toBe(400)
    expect((await call(env, 'POST', '', { device: 'Bion!', command: { type: 'pause' } })).status).toBe(400)
    expect((await call(env, 'POST', '', { device: 'bion', command: { type: 'play', profileId: 'elof' } })).status).toBe(400)
    expect((await call(env, 'GET', '?device=')).status).toBe(400)
    expect(cleanCommand({ type: 'seek', by: 99999 })).toEqual({ type: 'seek', by: 3600 })
    expect(cleanCommand({ type: 'seek', by: 0 })).toBeNull()
    expect(cleanCommand({ type: 'pause', extra: 'x' })).toEqual({ type: 'pause' })
    expect(cleanCommand({ type: 'play', source: 'iptv', profileId: 'elof', itemId: 'm_1' })).toMatchObject({ source: 'iptv' })
    expect(cleanCommand({ type: 'play', source: 'ftp', profileId: 'elof', itemId: 'm_1' })).toMatchObject({ source: 'home' })
  })

  it('takes a point to seek to, and tracks by id', () => {
    expect(cleanCommand({ type: 'seek', to: 125.6 })).toEqual({ type: 'seek', to: 126 })
    expect(cleanCommand({ type: 'seek', to: -5 })).toEqual({ type: 'seek', to: 0 })
    expect(cleanCommand({ type: 'seek', to: 'x' })).toBeNull()
    expect(cleanCommand({ type: 'audio', id: 2 })).toEqual({ type: 'audio', id: 2 })
    expect(cleanCommand({ type: 'audio', id: -1 })).toBeNull()
    expect(cleanCommand({ type: 'subtitle', id: -1 })).toEqual({ type: 'subtitle', id: -1 })
    expect(cleanCommand({ type: 'subtitle', id: 1.5 })).toBeNull()
    expect(cleanCommand({ type: 'hold' })).toEqual({ type: 'hold' })
  })

  it('wakes the cinema in Home Assistant on a Play to Bion, and nothing else', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const waited: Promise<unknown>[] = []
    const env = { DB: memoryDb().db, HA_BION_WEBHOOK: 'https://ha.example/api/webhook/abc' }
    const post = (device: string, command: unknown) => onRequest({
      request: new Request('https://x/api/bion', { method: 'POST', body: JSON.stringify({ device, command }) }),
      env: env as never,
      waitUntil: (p) => { waited.push(p) },
    })
    await post('bion', { type: 'play', source: 'iptv', profileId: 'elof', itemId: 'm_1' })
    await post('bion', { type: 'pause' })
    await post('other', { type: 'play', profileId: 'elof', itemId: 'm_1' })
    await Promise.all(waited)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toMatchObject(['https://ha.example/api/webhook/abc', { method: 'POST', body: '{"source":"iptv"}' }])
  })

  it('sends the volume to Home Assistant as a level, and never to the kiosk', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const m = memoryDb()
    const env = { DB: m.db, HA_BION_WEBHOOK: 'https://ha.example/api/webhook/abc' }
    const res = await call(env, 'POST', '', { device: 'bion', command: { type: 'volume', to: 0.473 } })
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0]).toMatchObject(['https://ha.example/api/webhook/abc', { body: '{"volume":0.47}' }])
    expect(m.commands).toHaveLength(0)
    expect(cleanCommand({ type: 'volume', to: 5 })).toEqual({ type: 'volume', to: 0.8 })
    expect(cleanCommand({ type: 'volume' })).toBeNull()
    // The phone hears when it did not get there.
    fetchMock.mockImplementation(async () => { throw new Error('down') })
    expect((await call(env, 'POST', '', { device: 'bion', command: { type: 'volume', to: 0.5 } })).status).toBe(502)
    expect((await call({ DB: m.db }, 'POST', '', { device: 'bion', command: { type: 'volume', to: 0.5 } })).status).toBe(502)
  })

  it("hands the phone the receiver's status beside the kiosk's", async () => {
    const env = { DB: memoryDb().db }
    await call(env, 'PUT', '', { device: 'receivern', status: { state: 'on', volume: 0.45, muted: false } })
    const res = await call(env, 'GET', '?device=bion')
    expect(res.body.receiver).toMatchObject({ state: 'on', volume: 0.45 })
    expect((await call(env, 'GET', '?device=receivern')).body.receiver).toBeUndefined()
  })

  it('plays as before when Home Assistant does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const env = { DB: memoryDb().db, HA_BION_WEBHOOK: 'https://ha.example/api/webhook/abc' }
    const res = await call(env, 'POST', '', { device: 'bion', command: { type: 'play', profileId: 'elof', itemId: 'x' } })
    expect(res.status).toBe(200)
  })

  it('keeps the latest status per device, stamped with server time', async () => {
    const m = memoryDb()
    const env = { DB: m.db }
    await call(env, 'PUT', '', { device: 'bion', status: { state: 'playing', title: 'Filmen', position: 12 } })
    await call(env, 'PUT', '', { device: 'bion', status: { state: 'paused', title: 'Filmen', position: 15 } })
    const res = await call(env, 'GET', '?device=bion')
    expect(res.body.status).toMatchObject({ state: 'paused', position: 15 })
    expect(typeof res.body.status.updated).toBe('number')
  })
})

describe('reading the status', () => {
  const now = 1_000_000

  it('shows the remote only while something is on and the kiosk has spoken lately', () => {
    expect(isBionActive({ state: 'playing', updated: now - 1000 }, now)).toBe(true)
    expect(isBionActive({ state: 'paused', updated: now - 1000 }, now)).toBe(true)
    expect(isBionActive({ state: 'waiting', updated: now - 1000 }, now)).toBe(true)
    expect(isBionActive({ state: 'idle', updated: now - 1000 }, now)).toBe(false)
    // A kiosk that was switched off mid-film leaves "playing" behind; it goes stale.
    expect(isBionActive({ state: 'playing', updated: now - STATUS_FRESH_MS - 1 }, now)).toBe(false)
    expect(isBionActive(null, now)).toBe(false)
  })

  it('shows "starting" at once, before the kiosk has answered', () => {
    expect(bionVisible({ status: null, clockSkew: 0, pending: { title: 'X', at: now - 2000 } }, now)).toBe(true)
    expect(bionVisible({ status: null, clockSkew: 0, pending: { title: 'X', at: now - 60_000 } }, now)).toBe(false)
  })

  it('judges the server stamp by the server clock', () => {
    // The phone's clock is ten minutes slow; the status is a second old by the server.
    const skew = 600_000
    expect(bionVisible({ status: { state: 'playing', updated: now + skew - 1000 }, clockSkew: skew, pending: null }, now)).toBe(true)
  })

  it('keeps a failure on screen long enough to be read', () => {
    expect(bionVisible({ status: { state: 'failed', updated: now - 5000 }, clockSkew: 0, pending: null }, now)).toBe(true)
    expect(bionVisible({ status: { state: 'failed', updated: now - STATUS_FRESH_MS - 1 }, clockSkew: 0, pending: null }, now)).toBe(false)
  })

  it('seeks inside the file that is playing', () => {
    expect(seekTarget(5, -10, 100)).toBe(0)
    expect(seekTarget(95, 30, 100)).toBe(99)
    expect(seekTarget(50, 30, Infinity)).toBe(80)
  })
})

describe('Bion mode', () => {
  const channel: Channel = { id: 'm_42', name: 'Arrival [2016]', url: 'http://example.invalid/movie/42.mkv', logo: '', groupTitle: 'VOD', type: 'movie', sortIndex: 0, movieTitle: 'Arrival' }
  const sent = () => (vi.mocked(fetch).mock.calls as [string, RequestInit][])
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init.body)))

  afterEach(() => {
    useBionStore.setState({ mode: false, pending: null })
    usePlayerStore.setState({ current: null })
    useHomeLibraryStore.setState({ playing: null, profileId: null })
    vi.unstubAllGlobals()
  })

  it('sends a Play to Bion instead of opening the player here', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}')))
    useProfileStore.setState({ activeProfileId: 'elof' })
    useBionStore.setState({ mode: true })
    usePlayerStore.getState().play(channel)
    await Promise.resolve()
    expect(usePlayerStore.getState().current).toBeNull()
    expect(sent()).toEqual([{ device: 'bion', command: { type: 'play', source: 'iptv', profileId: 'elof', itemId: 'm_42' } }])
    expect(useBionStore.getState().pending?.title).toBe('Arrival')
  })

  it('sends a home film as the profile the library was loaded for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}')))
    useBionStore.setState({ mode: true })
    useHomeLibraryStore.setState({ profileId: 'vera' })
    const item = { id: 'jf1', name: 'Paul', durationSec: 6000, positionSec: 0, played: false } as never
    useHomeLibraryStore.getState().play(item, { fromStart: true })
    await Promise.resolve()
    expect(useHomeLibraryStore.getState().playing).toBeNull()
    expect(sent()[0].command).toEqual({ type: 'play', source: 'home', profileId: 'vera', itemId: 'jf1', fromStart: true })
  })

  it('plays here as before when the mode is off', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    useProfileStore.setState({ activeProfileId: 'elof' })
    usePlayerStore.getState().play(channel)
    expect(usePlayerStore.getState().current?.id).toBe('m_42')
    expect(sent()).toEqual([])
  })

  it('counts the kiosk as on while its idle heartbeat is recent', () => {
    const now = 5_000_000
    expect(bionAlive({ status: { state: 'idle', updated: now - 60_000 }, clockSkew: 0 }, now)).toBe(true)
    expect(bionAlive({ status: { state: 'idle', updated: now - ALIVE_MS - 1 }, clockSkew: 0 }, now)).toBe(false)
    expect(bionAlive({ status: null, clockSkew: 0 }, now)).toBe(false)
  })

  it('names an episode by its show', () => {
    expect(channelTitle({ ...channel, type: 'series', showName: 'Severance', season: 1, episode: 2 })).toBe('Severance · S01E02')
  })
})

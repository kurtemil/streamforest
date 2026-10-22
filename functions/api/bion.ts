// /api/bion — the phone tells a kiosk what to play (`bion` in the basement, or
// `vardagsrum`, the TV in the living room), and the kiosk tells the phone what it is
// doing. No socket and no push: the kiosk asks every two
// seconds (GET with `after`), the phone posts a command (POST) and reads the status
// the kiosk keeps writing (PUT). Two small tables in the same D1 as everything else.
//
// Two seconds of polling is 43 200 requests a day with the kiosk on all day, against
// a free tier of five million rows read. Commands are pruned after an hour, so every
// poll reads a handful of rows at most.

interface D1Database {
  prepare(query: string): D1PreparedStatement
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  run(): Promise<unknown>
  all(): Promise<{ results: Record<string, unknown>[] }>
}

interface Env {
  DB: D1Database
  /**
   * Home Assistant's webhook for the cinema, the whole URL (Pages secret). A Play on
   * Bion calls it, and HA switches the receiver and the projector on, and holds the
   * film while the lamp warms up. The remote's volume goes the same way. A Play in the
   * living room calls it too, with `device` and the Play's `seq`: HA then opens the
   * TV's kiosk at that Play. Unset: the kiosks play as before, and there is no volume.
   */
  HA_BION_WEBHOOK?: string
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

/** A command older than this is not carried out: a kiosk that was off must not start a film it was asked for an hour ago. */
export const COMMAND_TTL_MS = 60_000
const PRUNE_AFTER_MS = 60 * 60 * 1000
const COMMAND_TYPES = new Set(['play', 'pause', 'resume', 'seek', 'stop', 'audio', 'subtitle', 'hold', 'volume'])
/** The receiver's own status row, which Home Assistant writes when its volume or power changes. */
const RECEIVER = 'receivern'
/** HA's volume is dB + 100 over 100: 0.8 is −20 dB, louder than anyone needs. HA clamps it too. */
const MAX_VOLUME = 0.8
/** The longest film there is, near enough. A seek to a point is clamped to it. */
const MAX_FILM_SECONDS = 24 * 3600
/** What the kiosk's status may weigh: enough for a film's track lists. */
const MAX_STATUS_CHARS = 8000
const DEVICE = /^[a-z0-9-]{1,32}$/

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS })

async function ensureTables(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS bion_commands (
      seq     INTEGER PRIMARY KEY AUTOINCREMENT,
      device  TEXT    NOT NULL,
      body    TEXT    NOT NULL,
      created INTEGER NOT NULL
    )
  `).run()
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS bion_status (
      device  TEXT    PRIMARY KEY,
      body    TEXT    NOT NULL,
      updated INTEGER NOT NULL
    )
  `).run()
}

/** What a command may carry. Anything else is dropped, so the table holds only what the kiosk understands. */
export function cleanCommand(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.type !== 'string' || !COMMAND_TYPES.has(c.type)) return null
  if (c.type === 'play') {
    if (typeof c.profileId !== 'string' || typeof c.itemId !== 'string') return null
    // `home` is the home server's Jellyfin, `iptv` the playlist. Older phones sent no source.
    const source = c.source === 'iptv' ? 'iptv' : 'home'
    return { type: 'play', source, profileId: c.profileId, itemId: c.itemId, fromStart: c.fromStart === true }
  }
  if (c.type === 'seek') {
    // `to` is a point in the film (the remote's scrubber), `by` a step from where it is.
    if (c.to !== undefined) {
      const to = Number(c.to)
      if (!Number.isFinite(to)) return null
      return { type: 'seek', to: Math.max(0, Math.min(MAX_FILM_SECONDS, Math.round(to))) }
    }
    const by = Number(c.by)
    if (!Number.isFinite(by) || by === 0) return null
    return { type: 'seek', by: Math.max(-3600, Math.min(3600, by)) }
  }
  if (c.type === 'audio' || c.type === 'subtitle') {
    // A track id as the kiosk's status listed it; -1 turns subtitles off.
    const id = Number(c.id)
    if (!Number.isInteger(id) || id < (c.type === 'subtitle' ? -1 : 0) || id > 999) return null
    return { type: c.type, id }
  }
  if (c.type === 'volume') {
    // The receiver's level as Home Assistant counts it, 0–1. Always a level, never a
    // step: taps that arrive close together must not each read a stale level and add to it.
    const to = Number(c.to)
    if (!Number.isFinite(to)) return null
    return { type: 'volume', to: Math.round(Math.max(0, Math.min(MAX_VOLUME, to)) * 100) / 100 }
  }
  return { type: c.type }
}

/**
 * Tells Home Assistant something: `{ source }` for a Play on Bion, which switches the
 * cinema on, `{ volume }` for the receiver, or `{ device: 'vardagsrum', source, seq }`
 * for a Play in the living room, which opens the TV's kiosk at that seq. Bion's body
 * has no `device`, as before there were two kiosks. False when HA could not be reached.
 */
async function callHome(env: Env, body: Record<string, unknown>): Promise<boolean> {
  if (!env.HA_BION_WEBHOOK) return false
  try {
    const res = await fetch(env.HA_BION_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function onRequest(context: {
  request: Request
  env: Env
  waitUntil?: (promise: Promise<unknown>) => void
}): Promise<Response> {
  const { request, env } = context
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') return new Response(null, { headers: HEADERS })
  if (!env.DB) return json({ error: 'D1 not configured' }, 503)

  try {
    await ensureTables(env)
    const now = Date.now()

    if (request.method === 'GET') {
      const device = url.searchParams.get('device') ?? ''
      if (!DEVICE.test(device)) return json({ error: 'Bad device' }, 400)
      const latestRow = (await env.DB.prepare('SELECT MAX(seq) AS latest FROM bion_commands WHERE device = ?')
        .bind(device).all()).results[0]
      const latest = Number(latestRow?.latest ?? 0) || 0
      const statusRow = (await env.DB.prepare('SELECT body, updated FROM bion_status WHERE device = ?')
        .bind(device).all()).results[0]
      const status = statusRow ? { ...JSON.parse(String(statusRow.body)), updated: Number(statusRow.updated) } : null

      // Without `after` the caller only wants to know where the queue stands: the
      // kiosk on start, so it never replays what was sent before it came up.
      const afterParam = url.searchParams.get('after')
      let commands: Record<string, unknown>[] = []
      if (afterParam !== null) {
        const after = Number(afterParam) || 0
        const rows = (await env.DB.prepare(
          'SELECT seq, body, created FROM bion_commands WHERE device = ? AND seq > ? AND created > ? ORDER BY seq LIMIT 20',
        ).bind(device, after, now - COMMAND_TTL_MS).all()).results
        commands = rows.map((r) => ({ ...JSON.parse(String(r.body)), seq: Number(r.seq) }))
      }
      // The phone's remote shows the receiver's volume beside what the kiosk plays.
      if (device === 'bion') {
        const receiverRow = (await env.DB.prepare('SELECT body, updated FROM bion_status WHERE device = ?')
          .bind(RECEIVER).all()).results[0]
        const receiver = receiverRow ? { ...JSON.parse(String(receiverRow.body)), updated: Number(receiverRow.updated) } : null
        return json({ now, latest, commands, status, receiver })
      }
      return json({ now, latest, commands, status })
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => null) as { device?: unknown; command?: unknown } | null
      const device = typeof body?.device === 'string' ? body.device : ''
      const command = cleanCommand(body?.command)
      if (!DEVICE.test(device) || !command) return json({ error: 'Bad command' }, 400)
      // The volume is the receiver's, not the kiosk's: it goes straight to HA, and
      // the phone hears whether it got there.
      if (command.type === 'volume') {
        if (device !== 'bion') return json({ error: 'Bad command' }, 400)
        return (await callHome(env, { volume: command.to })) ? json({ ok: true }) : json({ error: 'Home Assistant did not answer' }, 502)
      }
      await env.DB.prepare('INSERT INTO bion_commands (device, body, created) VALUES (?, ?, ?)')
        .bind(device, JSON.stringify(command), now).run()
      await env.DB.prepare('DELETE FROM bion_commands WHERE created < ?').bind(now - PRUNE_AFTER_MS).run()
      // A Play switches the cinema on, or opens the TV's kiosk upstairs, which polls
      // only while it is open. Never holds up the answer: the film is queued either way.
      if (command.type === 'play' && (device === 'bion' || device === 'vardagsrum')) {
        let body: Record<string, unknown> = { source: command.source }
        if (device === 'vardagsrum') {
          const row = (await env.DB.prepare('SELECT MAX(seq) AS latest FROM bion_commands WHERE device = ?')
            .bind(device).all()).results[0]
          body = { device, source: command.source, seq: Number(row?.latest ?? 0) || 0 }
        }
        const woken = callHome(env, body)
        if (context.waitUntil) context.waitUntil(woken)
        else await woken
      }
      return json({ ok: true })
    }

    if (request.method === 'PUT') {
      const body = await request.json().catch(() => null) as { device?: unknown; status?: unknown } | null
      const device = typeof body?.device === 'string' ? body.device : ''
      if (!DEVICE.test(device) || !body?.status || typeof body.status !== 'object') return json({ error: 'Bad status' }, 400)
      const text = JSON.stringify(body.status)
      if (text.length > MAX_STATUS_CHARS) return json({ error: 'Status too large' }, 413)
      await env.DB.prepare(`
        INSERT INTO bion_status (device, body, updated) VALUES (?, ?, ?)
        ON CONFLICT (device) DO UPDATE SET body = excluded.body, updated = excluded.updated
      `).bind(device, text, now).run()
      return json({ ok: true })
    }

    return new Response('Method not allowed', { status: 405, headers: HEADERS })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
}

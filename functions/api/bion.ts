// /api/bion — the phone tells the kiosk in the basement what to play, and the kiosk
// tells the phone what it is doing. No socket and no push: the kiosk asks every two
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
const COMMAND_TYPES = new Set(['play', 'pause', 'resume', 'seek', 'stop'])
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
    const by = Number(c.by)
    if (!Number.isFinite(by) || by === 0) return null
    return { type: 'seek', by: Math.max(-3600, Math.min(3600, by)) }
  }
  return { type: c.type }
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
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
      return json({ now, latest, commands, status })
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => null) as { device?: unknown; command?: unknown } | null
      const device = typeof body?.device === 'string' ? body.device : ''
      const command = cleanCommand(body?.command)
      if (!DEVICE.test(device) || !command) return json({ error: 'Bad command' }, 400)
      await env.DB.prepare('INSERT INTO bion_commands (device, body, created) VALUES (?, ?, ?)')
        .bind(device, JSON.stringify(command), now).run()
      await env.DB.prepare('DELETE FROM bion_commands WHERE created < ?').bind(now - PRUNE_AFTER_MS).run()
      return json({ ok: true })
    }

    if (request.method === 'PUT') {
      const body = await request.json().catch(() => null) as { device?: unknown; status?: unknown } | null
      const device = typeof body?.device === 'string' ? body.device : ''
      if (!DEVICE.test(device) || !body?.status || typeof body.status !== 'object') return json({ error: 'Bad status' }, 400)
      const text = JSON.stringify(body.status)
      if (text.length > 2000) return json({ error: 'Status too large' }, 413)
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

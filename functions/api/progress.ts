interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown>
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  run(): Promise<unknown>
  all(): Promise<{ results: Record<string, unknown>[] }>
}
/** Upper bound for one request, so a single call stays well inside D1's limits. */
const MAX_BATCH = 200

interface Env {
  DB: D1Database
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
}

async function ensureTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS watch_progress (
      profile_id  TEXT    NOT NULL,
      channel_id  TEXT    NOT NULL,
      position    REAL    NOT NULL,
      duration    REAL    NOT NULL,
      last_watched INTEGER NOT NULL,
      completed   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (profile_id, channel_id)
    )
  `).run()
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: HEADERS })
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 503, headers: HEADERS })
  }

  try {
    await ensureTable(env)

    if (request.method === 'GET') {
      const profileId = url.searchParams.get('profileId')
      if (!profileId) return new Response(JSON.stringify({ error: 'Missing profileId' }), { status: 400, headers: HEADERS })

      const result = await env.DB.prepare(
        'SELECT profile_id, channel_id, position, duration, last_watched, completed FROM watch_progress WHERE profile_id = ?'
      ).bind(profileId).all()

      const rows = (result.results ?? []).map((r) => ({
        id: `${r.profile_id}:${r.channel_id}`,
        profileId: r.profile_id,
        channelId: r.channel_id,
        position: r.position,
        duration: r.duration,
        lastWatched: r.last_watched,
        completed: Boolean(r.completed),
      }))
      return new Response(JSON.stringify(rows), { headers: HEADERS })
    }

    if (request.method === 'PUT') {
      // One entry, or a list: marking a whole show as watched writes every episode
      // at once, and one request per episode would be hundreds of them.
      type Entry = {
        profileId: string; channelId: string; position: number
        duration: number; lastWatched: number; completed: boolean
      }
      const body = await request.json() as Entry | Entry[]
      const entries = (Array.isArray(body) ? body : [body]).slice(0, MAX_BATCH)
      const upsert = env.DB.prepare(`
        INSERT INTO watch_progress (profile_id, channel_id, position, duration, last_watched, completed)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (profile_id, channel_id) DO UPDATE SET
          position     = excluded.position,
          duration     = excluded.duration,
          last_watched = excluded.last_watched,
          completed    = excluded.completed
        WHERE excluded.last_watched >= watch_progress.last_watched
      `)
      await env.DB.batch(entries.map((e) => upsert.bind(
        e.profileId, e.channelId, e.position, e.duration, e.lastWatched, e.completed ? 1 : 0,
      )))
      return new Response('{"ok":true}', { headers: HEADERS })
    }

    if (request.method === 'DELETE') {
      // ?channelId= for one, or a JSON body { channelIds } for many (unmarking a show).
      const profileId = url.searchParams.get('profileId')
      const one = url.searchParams.get('channelId')
      const many = one ? [one] : ((await request.json().catch(() => ({}))) as { channelIds?: string[] }).channelIds ?? []
      if (!profileId || many.length === 0) {
        return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400, headers: HEADERS })
      }
      const del = env.DB.prepare('DELETE FROM watch_progress WHERE profile_id = ? AND channel_id = ?')
      await env.DB.batch(many.slice(0, MAX_BATCH).map((id) => del.bind(profileId, id)))
      return new Response('{"ok":true}', { headers: HEADERS })
    }

    return new Response('Method not allowed', { status: 405, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: HEADERS })
  }
}

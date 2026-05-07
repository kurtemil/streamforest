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
      const body = await request.json() as {
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
      `).bind(
        body.profileId, body.channelId,
        body.position, body.duration,
        body.lastWatched, body.completed ? 1 : 0
      ).run()
      return new Response('{"ok":true}', { headers: HEADERS })
    }

    if (request.method === 'DELETE') {
      const profileId = url.searchParams.get('profileId')
      const channelId = url.searchParams.get('channelId')
      if (!profileId || !channelId) {
        return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400, headers: HEADERS })
      }
      await env.DB.prepare('DELETE FROM watch_progress WHERE profile_id = ? AND channel_id = ?')
        .bind(profileId, channelId).run()
      return new Response('{"ok":true}', { headers: HEADERS })
    }

    return new Response('Method not allowed', { status: 405, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: HEADERS })
  }
}

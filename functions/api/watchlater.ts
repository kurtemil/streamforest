interface D1Database {
  prepare(query: string): D1PreparedStatement
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  run(): Promise<unknown>
  all(): Promise<{ results: Record<string, unknown>[] }>
}
interface Env { DB: D1Database }

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
}

async function ensureTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS watch_later (
      profile_id TEXT NOT NULL,
      content_id TEXT NOT NULL,
      kind       TEXT NOT NULL,
      added_at   INTEGER NOT NULL,
      PRIMARY KEY (profile_id, content_id)
    )
  `).run()
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') return new Response(null, { headers: HEADERS })
  if (!env.DB) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 503, headers: HEADERS })

  try {
    await ensureTable(env)

    if (request.method === 'GET') {
      const profileId = url.searchParams.get('profileId')
      if (!profileId) return new Response(JSON.stringify({ error: 'Missing profileId' }), { status: 400, headers: HEADERS })

      const result = await env.DB.prepare(
        'SELECT profile_id, content_id, kind, added_at FROM watch_later WHERE profile_id = ? ORDER BY added_at DESC'
      ).bind(profileId).all()

      const rows = (result.results ?? []).map((r) => ({
        id: `${r.profile_id}:${r.content_id}`,
        profileId: r.profile_id,
        contentId: r.content_id,
        kind: r.kind,
        addedAt: r.added_at,
      }))
      return new Response(JSON.stringify(rows), { headers: HEADERS })
    }

    if (request.method === 'PUT') {
      const body = await request.json() as { profileId: string; contentId: string; kind: string; addedAt: number }
      await env.DB.prepare(`
        INSERT INTO watch_later (profile_id, content_id, kind, added_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (profile_id, content_id) DO UPDATE SET kind = excluded.kind, added_at = excluded.added_at
      `).bind(body.profileId, body.contentId, body.kind, body.addedAt).run()
      return new Response('{"ok":true}', { headers: HEADERS })
    }

    if (request.method === 'DELETE') {
      const profileId = url.searchParams.get('profileId')
      const contentId = url.searchParams.get('contentId')
      if (!profileId || !contentId) return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400, headers: HEADERS })
      await env.DB.prepare('DELETE FROM watch_later WHERE profile_id = ? AND content_id = ?')
        .bind(profileId, contentId).run()
      return new Response('{"ok":true}', { headers: HEADERS })
    }

    return new Response('Method not allowed', { status: 405, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: HEADERS })
  }
}

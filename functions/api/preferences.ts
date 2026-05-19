interface D1Database {
  prepare(query: string): D1PreparedStatement
  exec(query: string): Promise<unknown>
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  run(): Promise<unknown>
  all(): Promise<{ results: Record<string, unknown>[] }>
}
interface Env { DB: D1Database }

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Content-Type': 'application/json',
}

async function ensureTable(env: Env) {
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

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') return new Response(null, { headers: HEADERS })

  await ensureTable(env)

  // GET /api/preferences?profileId=elof  →  { key: value, ... }
  if (request.method === 'GET') {
    const profileId = url.searchParams.get('profileId')
    if (!profileId) return new Response(JSON.stringify({ error: 'Missing profileId' }), { status: 400, headers: HEADERS })

    const rows = await env.DB.prepare(
      'SELECT key, value FROM user_preferences WHERE profile_id = ?'
    ).bind(profileId).all()

    const result: Record<string, string> = {}
    for (const row of rows.results) {
      result[row.key as string] = row.value as string
    }
    return new Response(JSON.stringify(result), { headers: HEADERS })
  }

  // PUT /api/preferences  body: { profileId, key, value }
  if (request.method === 'PUT') {
    const body = await request.json() as { profileId?: string; key?: string; value?: string }
    const { profileId, key, value } = body
    if (!profileId || !key || value === undefined) {
      return new Response(JSON.stringify({ error: 'Missing profileId, key, or value' }), { status: 400, headers: HEADERS })
    }
    await env.DB.prepare(
      'INSERT OR REPLACE INTO user_preferences (profile_id, key, value, updated_at) VALUES (?, ?, ?, ?)'
    ).bind(profileId, key, value, Date.now()).run()
    return new Response(JSON.stringify({ ok: true }), { headers: HEADERS })
  }

  return new Response('Method not allowed', { status: 405, headers: HEADERS })
}

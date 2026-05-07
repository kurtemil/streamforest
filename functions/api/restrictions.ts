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
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Content-Type': 'application/json',
}

async function ensureTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS kid_restrictions (
      profile_id   TEXT PRIMARY KEY,
      restrictions TEXT NOT NULL DEFAULT '{}'
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

      const row = await env.DB.prepare(
        'SELECT restrictions FROM kid_restrictions WHERE profile_id = ?'
      ).bind(profileId).first<{ restrictions: string }>()

      return new Response(row?.restrictions ?? '{"movie":[],"series":[],"live":[]}', { headers: HEADERS })
    }

    if (request.method === 'PUT') {
      const body = await request.json() as { profileId: string; movie: string[]; series: string[]; live: string[] }
      const json = JSON.stringify({ movie: body.movie, series: body.series, live: body.live })
      await env.DB.prepare(`
        INSERT INTO kid_restrictions (profile_id, restrictions) VALUES (?, ?)
        ON CONFLICT (profile_id) DO UPDATE SET restrictions = excluded.restrictions
      `).bind(body.profileId, json).run()
      return new Response('{"ok":true}', { headers: HEADERS })
    }

    return new Response('Method not allowed', { status: 405, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: HEADERS })
  }
}

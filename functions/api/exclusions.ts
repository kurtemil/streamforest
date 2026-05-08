interface D1Database {
  prepare(query: string): D1PreparedStatement
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  run(): Promise<unknown>
  all(): Promise<{ results: Record<string, unknown>[] }>
  first(): Promise<Record<string, unknown> | null>
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
    CREATE TABLE IF NOT EXISTS group_exclusions (
      profile_id TEXT PRIMARY KEY,
      movie      TEXT NOT NULL DEFAULT '[]',
      series     TEXT NOT NULL DEFAULT '[]',
      live       TEXT NOT NULL DEFAULT '[]'
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

      const row = await env.DB.prepare(
        'SELECT movie, series, live FROM group_exclusions WHERE profile_id = ?'
      ).bind(profileId).first()

      const result = {
        movie:  JSON.parse((row?.movie  as string | null) ?? '[]') as string[],
        series: JSON.parse((row?.series as string | null) ?? '[]') as string[],
        live:   JSON.parse((row?.live   as string | null) ?? '[]') as string[],
      }
      return new Response(JSON.stringify(result), { headers: HEADERS })
    }

    if (request.method === 'PUT') {
      const body = await request.json() as {
        profileId: string
        movie: string[]
        series: string[]
        live: string[]
      }
      await env.DB.prepare(`
        INSERT INTO group_exclusions (profile_id, movie, series, live)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (profile_id) DO UPDATE SET
          movie  = excluded.movie,
          series = excluded.series,
          live   = excluded.live
      `).bind(
        body.profileId,
        JSON.stringify(body.movie ?? []),
        JSON.stringify(body.series ?? []),
        JSON.stringify(body.live ?? []),
      ).run()
      return new Response('{"ok":true}', { headers: HEADERS })
    }

    return new Response('Method not allowed', { status: 405, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: HEADERS })
  }
}

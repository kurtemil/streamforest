interface D1Database {
  prepare(query: string): D1PreparedStatement
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  run(): Promise<unknown>
  all(): Promise<{ results: Record<string, unknown>[] }>
  first<T = Record<string, unknown>>(): Promise<T | null>
}
interface Env {
  DB: D1Database
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function ensureTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS profile_pins (
      profile_id TEXT PRIMARY KEY,
      pin_hash   TEXT NOT NULL
    )
  `).run()
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: HEADERS })
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 503, headers: HEADERS })
  }

  try {
    await ensureTable(env)

    if (request.method === 'POST') {
      const { profile_id, pin } = (await request.json()) as { profile_id: string; pin: string }

      if (!profile_id || !pin) {
        return new Response('{"ok":false}', { status: 400, headers: HEADERS })
      }

      const hash = await sha256(pin)
      const row = await env.DB.prepare('SELECT pin_hash FROM profile_pins WHERE profile_id = ?')
        .bind(profile_id)
        .first<{ pin_hash: string }>()

      const ok = row?.pin_hash === hash
      return new Response(JSON.stringify({ ok }), { headers: HEADERS })
    }

    return new Response('Method not allowed', { status: 405, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: HEADERS })
  }
}

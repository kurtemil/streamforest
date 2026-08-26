// Bug reports and wishes, written from inside the app.
//
// Ported from `lagom`, which has had the same box on its profile page for a
// while, and for the same reason: the moment you notice something wrong is the
// moment you are holding the phone, and anything that requires opening a laptop
// afterwards never gets written down. Deliberately dumb storage — free text,
// who, when, and which phone it came from.
//
// The one thing carried over unchanged is `resolved`: an item is ticked off,
// never deleted on being fixed, so "what did we already do?" stays answerable.
//
// Same shape as every other Function here: it creates its own table on first
// use rather than depending on a migration step nobody remembers to run.

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
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Content-Type': 'application/json',
}

/** Long enough for a paragraph of detail, short enough that D1 stays boring. */
const MAX_BODY = 2000
/** The inbox is read, not paged. A household will not reach this. */
const MAX_ROWS = 300

async function ensureTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS feedback (
      id          TEXT    PRIMARY KEY,
      profile_id  TEXT,
      author_name TEXT    NOT NULL,
      kind        TEXT    NOT NULL DEFAULT 'bug',
      body        TEXT    NOT NULL,
      resolved    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      user_agent  TEXT,
      context     TEXT
    )
  `).run()
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC)'
  ).run()
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_feedback_profile ON feedback(profile_id, created_at DESC)'
  ).run()
}

/** Anything unrecognised reads as a bug — the safer of the two to look at. */
function asKind(v: unknown): 'bug' | 'idea' {
  return v === 'idea' ? 'idea' : 'bug'
}

function toJson(r: Record<string, unknown>) {
  return {
    id: r.id,
    profileId: r.profile_id,
    authorName: r.author_name,
    kind: asKind(r.kind),
    body: r.body,
    resolved: Boolean(r.resolved),
    createdAt: r.created_at,
    userAgent: r.user_agent ?? null,
    context: r.context ?? null,
  }
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') return new Response(null, { headers: HEADERS })
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 503, headers: HEADERS })
  }

  try {
    await ensureTable(env)

    if (request.method === 'GET') {
      // `scope=all` is the household inbox; anything else is one person's own
      // reports. Which one the app asks for is decided by the profile's role in
      // the client, exactly like every other endpoint here — this app has no
      // server-side session, and adding one for a noindex page behind a PIN on
      // a household network would be a different project.
      const scope = url.searchParams.get('scope')
      const profileId = url.searchParams.get('profileId')

      const rows = scope === 'all'
        ? await env.DB.prepare(
            'SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?'
          ).bind(MAX_ROWS).all()
        : profileId
          ? await env.DB.prepare(
              'SELECT * FROM feedback WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?'
            ).bind(profileId, MAX_ROWS).all()
          : { results: [] }

      return new Response(JSON.stringify((rows.results ?? []).map(toJson)), { headers: HEADERS })
    }

    if (request.method === 'POST') {
      const body = await request.json() as {
        profileId?: string; authorName?: string; kind?: string
        body?: string; context?: string
      }
      const text = (body.body ?? '').trim()
      if (!text) {
        return new Response(JSON.stringify({ error: 'Empty body' }), { status: 400, headers: HEADERS })
      }
      if (!body.profileId || !body.authorName) {
        return new Response(JSON.stringify({ error: 'Missing profile' }), { status: 400, headers: HEADERS })
      }

      await env.DB.prepare(`
        INSERT INTO feedback (id, profile_id, author_name, kind, body, resolved, created_at, user_agent, context)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        body.profileId,
        // A snapshot rather than a join: the name on a report should survive the
        // profile list being edited.
        body.authorName.slice(0, 60),
        asKind(body.kind),
        text.slice(0, MAX_BODY),
        Date.now(),
        request.headers.get('user-agent')?.slice(0, 300) ?? null,
        body.context ?? null,
      ).run()

      return new Response('{"ok":true}', { headers: HEADERS })
    }

    if (request.method === 'PATCH') {
      const { id, resolved } = await request.json() as { id?: string; resolved?: boolean }
      if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: HEADERS })
      await env.DB.prepare('UPDATE feedback SET resolved = ? WHERE id = ?')
        .bind(resolved ? 1 : 0, id).run()
      return new Response('{"ok":true}', { headers: HEADERS })
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id')
      if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: HEADERS })
      await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run()
      return new Response('{"ok":true}', { headers: HEADERS })
    }

    return new Response('Method not allowed', { status: 405, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: HEADERS })
  }
}

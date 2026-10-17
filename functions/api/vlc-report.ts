// POST /api/vlc-report — where VLC's position comes back from someone's computer.
//
// The VLC handler (public/vlc-handler.{sh,ps1}) posts here every ten seconds while
// VLC plays a link StreamForest handed it, and once more when VLC closes. The
// body is what VLC's own web interface says plus the playlist link it was given;
// src/lib/vlcReport.ts decides what that means.
//
// The answer is plain lines, because the handler on a Mac is a shell script with
// no JSON parser to lean on:
//   OK                       saved (a StreamForest film or episode)
//   SKIP                     nothing worth saving yet
//   RELAY / path / auth / body   for a home-library film: the handler sends this
//                            to Jellyfin itself, since no Function can reach it.
//
// No authentication, like every other endpoint here: the profile comes from the
// link the app built, exactly as /api/progress takes it from the app.
import { currentEntry, jellyfinRelay, parseSrc, progressRow, type VlcStatus } from '../../src/lib/vlcReport'

interface D1Database {
  prepare(query: string): D1PreparedStatement
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  run(): Promise<unknown>
}
interface Env { DB: D1Database }

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
const line = (body: string, status = 200) => new Response(body + '\n', { status, headers: TEXT })

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context
  let s: VlcStatus
  try {
    s = await request.json() as VlcStatus
  } catch {
    return line('BAD', 400)
  }
  const parsed = parseSrc(String(s.src ?? ''), new URL(request.url).origin)
  if (!parsed) return line('BAD', 400)
  const item = currentEntry(parsed.items, s.uri)
  if (!item) return line('SKIP')

  if (parsed.target.k === 'jf') {
    const relay = jellyfinRelay(parsed.target, item, s)
    return relay ? line(['RELAY', relay.path, relay.auth, relay.body].join('\n')) : line('SKIP')
  }

  const row = progressRow(parsed.target, item, s, Date.now())
  if (!row) return line('SKIP')
  if (!env.DB) return line('NODB', 503)
  // Same table and the same rule as /api/progress: a newer row wins, so a phone
  // that played on afterwards is not pulled back by a late report from here.
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
  await env.DB.prepare(`
    INSERT INTO watch_progress (profile_id, channel_id, position, duration, last_watched, completed)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (profile_id, channel_id) DO UPDATE SET
      position     = excluded.position,
      duration     = excluded.duration,
      last_watched = excluded.last_watched,
      completed    = excluded.completed
    WHERE excluded.last_watched >= watch_progress.last_watched
  `).bind(row.profileId, row.channelId, row.position, row.duration, row.lastWatched, row.completed ? 1 : 0).run()
  return line('OK')
}

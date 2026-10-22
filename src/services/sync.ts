import { db } from './db'
import type { WatchProgress, WatchLater } from '@/types'
import { fireAndForget } from '@/lib/fireAndForget'

const PROGRESS_API = '/api/progress'
const WATCH_LATER_API = '/api/watchlater'

// ── Watch Progress ─────────────────────────────────────────────────────────────

export async function syncFromRemote(profileId: string): Promise<void> {
  try {
    const res = await fetch(`${PROGRESS_API}?profileId=${encodeURIComponent(profileId)}`)
    if (!res.ok) return
    const remote: WatchProgress[] = await res.json()
    if (remote.length === 0) return
    // One read and one write for the lot: a get and a put per entry took minutes
    // for 873 entries on the living room TV's kiosk, whose storage is slow.
    const local = await db.watchProgress.bulkGet(remote.map((r) => r.id))
    const newer = remote.filter((r, i) => !local[i] || r.lastWatched > local[i]!.lastWatched)
    if (newer.length > 0) await db.watchProgress.bulkPut(newer)
  } catch {
    // silent — offline or D1 not configured yet
  }
}

export function pushProgress(entry: WatchProgress): void {
  fireAndForget(PROGRESS_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
}

export function deleteRemoteProgress(profileId: string, channelId: string): void {
  fireAndForget(`${PROGRESS_API}?profileId=${encodeURIComponent(profileId)}&channelId=${encodeURIComponent(channelId)}`, {
    method: 'DELETE',
  })
}

/** Many entries in batches: one request per 200 instead of one per episode. */
export async function pushProgressMany(entries: WatchProgress[]): Promise<void> {
  for (let i = 0; i < entries.length; i += 200) {
    await fireAndForget(PROGRESS_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries.slice(i, i + 200)),
    })
  }
}

export async function deleteRemoteProgressMany(profileId: string, channelIds: string[]): Promise<void> {
  for (let i = 0; i < channelIds.length; i += 200) {
    await fireAndForget(`${PROGRESS_API}?profileId=${encodeURIComponent(profileId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelIds: channelIds.slice(i, i + 200) }),
    })
  }
}

// ── Watch Later ────────────────────────────────────────────────────────────────

export async function syncWatchLaterFromRemote(profileId: string): Promise<void> {
  try {
    const res = await fetch(`${WATCH_LATER_API}?profileId=${encodeURIComponent(profileId)}`)
    if (!res.ok) return
    const remote: WatchLater[] = await res.json()
    // Replace local with remote — remote is authoritative for watch later
    const localIds = await db.watchLater.where('profileId').equals(profileId).primaryKeys()
    const remoteIds = new Set(remote.map((r) => r.id))
    // Delete local entries not in remote
    const toDelete = localIds.filter((id) => !remoteIds.has(id as string))
    if (toDelete.length) await db.watchLater.bulkDelete(toDelete)
    // Upsert remote entries
    if (remote.length) await db.watchLater.bulkPut(remote)
  } catch {
    // silent
  }
}

export function pushWatchLater(entry: WatchLater): void {
  fireAndForget(WATCH_LATER_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
}

export function deleteRemoteWatchLater(profileId: string, contentId: string): void {
  fireAndForget(`${WATCH_LATER_API}?profileId=${encodeURIComponent(profileId)}&contentId=${encodeURIComponent(contentId)}`, {
    method: 'DELETE',
  })
}

import { db } from './db'
import type { WatchProgress, WatchLater } from '@/types'

const PROGRESS_API = '/api/progress'
const WATCH_LATER_API = '/api/watchlater'

// ── Watch Progress ─────────────────────────────────────────────────────────────

export async function syncFromRemote(profileId: string): Promise<void> {
  try {
    const res = await fetch(`${PROGRESS_API}?profileId=${encodeURIComponent(profileId)}`)
    if (!res.ok) return
    const remote: WatchProgress[] = await res.json()
    for (const r of remote) {
      const local = await db.watchProgress.get(r.id)
      if (!local || r.lastWatched > local.lastWatched) {
        await db.watchProgress.put(r)
      }
    }
  } catch {
    // silent — offline or D1 not configured yet
  }
}

export function pushProgress(entry: WatchProgress): void {
  fetch(PROGRESS_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  }).catch(() => {})
}

export function deleteRemoteProgress(profileId: string, channelId: string): void {
  fetch(`${PROGRESS_API}?profileId=${encodeURIComponent(profileId)}&channelId=${encodeURIComponent(channelId)}`, {
    method: 'DELETE',
  }).catch(() => {})
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
  fetch(WATCH_LATER_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  }).catch(() => {})
}

export function deleteRemoteWatchLater(profileId: string, contentId: string): void {
  fetch(`${WATCH_LATER_API}?profileId=${encodeURIComponent(profileId)}&contentId=${encodeURIComponent(contentId)}`, {
    method: 'DELETE',
  }).catch(() => {})
}

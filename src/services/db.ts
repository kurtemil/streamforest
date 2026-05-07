import Dexie, { type EntityTable } from 'dexie'
import type { Channel, WatchProgress, Favorite, PlaylistMeta, WatchLater } from '@/types'

class AppDB extends Dexie {
  channels!: EntityTable<Channel, 'id'>
  watchProgress!: EntityTable<WatchProgress, 'id'>
  favorites!: EntityTable<Favorite, 'id'>
  playlistMeta!: EntityTable<PlaylistMeta, 'id'>
  watchLater!: EntityTable<WatchLater, 'id'>

  constructor() {
    super('StreamForestDB')
    this.version(1).stores({
      channels: 'id, type, groupTitle, showName, season',
      watchProgress: 'id, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
    })
    this.version(2).stores({
      channels: 'id, type, groupTitle, showName, season, sortIndex',
      watchProgress: 'id, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
    })
    // v3 adds per-profile watch progress (migrate existing rows to 'elof')
    this.version(3).stores({
      channels: 'id, type, groupTitle, showName, season, sortIndex',
      watchProgress: 'id, profileId, channelId, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
    }).upgrade(async (tx) => {
      const old = await tx.table('watchProgress').toArray()
      await tx.table('watchProgress').clear()
      if (old.length > 0) {
        await tx.table('watchProgress').bulkPut(
          old.map((row) => ({
            id: `elof:${row.id}`,
            profileId: 'elof',
            channelId: row.id,
            position: row.position,
            duration: row.duration,
            lastWatched: row.lastWatched,
            completed: row.completed,
          }))
        )
      }
    })
    // v4 adds per-profile watch later list
    this.version(4).stores({
      channels: 'id, type, groupTitle, showName, season, sortIndex',
      watchProgress: 'id, profileId, channelId, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
      watchLater: 'id, profileId, contentId, kind, addedAt',
    })
  }
}

export const db = new AppDB()

export async function clearPlaylist() {
  await db.channels.clear()
  await db.playlistMeta.clear()
}

const SAVE_CHUNK = 2000

export async function saveChannels(
  channels: Channel[],
  url: string,
  onProgress?: (pct: number) => void,
) {
  await db.channels.clear()
  for (let i = 0; i < channels.length; i += SAVE_CHUNK) {
    await db.channels.bulkPut(channels.slice(i, i + SAVE_CHUNK))
    onProgress?.(Math.min(99, Math.round(((i + SAVE_CHUNK) / channels.length) * 100)))
  }
  const movieCount = channels.filter((c) => c.type === 'movie').length
  const seriesCount = channels.filter((c) => c.type === 'series').length
  const liveCount = channels.filter((c) => c.type === 'live').length
  await db.playlistMeta.put({
    id: 1, url,
    fetchedAt: Date.now(),
    entryCount: channels.length,
    movieCount, seriesCount, liveCount,
  })
  onProgress?.(100)
}

export async function getPlaylistMeta(): Promise<PlaylistMeta | undefined> {
  return db.playlistMeta.get(1)
}

export async function getProgress(profileId: string, channelId: string): Promise<WatchProgress | undefined> {
  return db.watchProgress.get(`${profileId}:${channelId}`)
}

export async function saveProgress(
  profileId: string,
  channelId: string,
  position: number,
  duration: number,
): Promise<WatchProgress> {
  const completed = duration > 0 && position / duration > 0.9
  const entry: WatchProgress = {
    id: `${profileId}:${channelId}`,
    profileId,
    channelId,
    position,
    duration,
    lastWatched: Date.now(),
    completed,
  }
  await db.watchProgress.put(entry)
  return entry
}

export async function clearProgress(profileId: string, channelId: string) {
  await db.watchProgress.delete(`${profileId}:${channelId}`)
}

export async function getRecentlyWatched(profileId: string, limit = 20): Promise<WatchProgress[]> {
  const all = await db.watchProgress.where('profileId').equals(profileId).toArray()
  return all.sort((a, b) => b.lastWatched - a.lastWatched).slice(0, limit)
}

export async function isFavorite(id: string): Promise<boolean> {
  return (await db.favorites.get(id)) !== undefined
}

export async function toggleFavorite(id: string, kind: 'movie' | 'series' | 'live') {
  if (await isFavorite(id)) {
    await db.favorites.delete(id)
  } else {
    await db.favorites.put({ id, kind, addedAt: Date.now() })
  }
}

// ── Watch Later ────────────────────────────────────────────────────────────────

export async function getWatchLater(profileId: string): Promise<WatchLater[]> {
  const all = await db.watchLater.where('profileId').equals(profileId).toArray()
  return all.sort((a, b) => b.addedAt - a.addedAt)
}

export async function isInWatchLater(profileId: string, contentId: string): Promise<boolean> {
  return (await db.watchLater.get(`${profileId}:${contentId}`)) !== undefined
}

export async function addToWatchLater(
  profileId: string,
  contentId: string,
  kind: 'movie' | 'series',
): Promise<WatchLater> {
  const entry: WatchLater = {
    id: `${profileId}:${contentId}`,
    profileId,
    contentId,
    kind,
    addedAt: Date.now(),
  }
  await db.watchLater.put(entry)
  return entry
}

export async function removeFromWatchLater(profileId: string, contentId: string) {
  await db.watchLater.delete(`${profileId}:${contentId}`)
}

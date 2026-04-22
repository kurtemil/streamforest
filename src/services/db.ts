import Dexie, { type EntityTable } from 'dexie'
import type { Channel, WatchProgress, Favorite, PlaylistMeta } from '@/types'

class AppDB extends Dexie {
  channels!: EntityTable<Channel, 'id'>
  watchProgress!: EntityTable<WatchProgress, 'id'>
  favorites!: EntityTable<Favorite, 'id'>
  playlistMeta!: EntityTable<PlaylistMeta, 'id'>

  constructor() {
    super('StreamForestDB')
    this.version(1).stores({
      channels: 'id, type, groupTitle, showName, season',
      watchProgress: 'id, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
    })
    // v2 adds sortIndex for M3U order preservation
    this.version(2).stores({
      channels: 'id, type, groupTitle, showName, season, sortIndex',
      watchProgress: 'id, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
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
  // bulkPut (upsert) avoids any BulkError from duplicate IDs — bulkAdd would roll back the whole
  // transaction on the first collision, silently dropping everything after the conflict point.
  // Chunked writes let us report save progress back to the UI.
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

export async function getProgress(id: string): Promise<WatchProgress | undefined> {
  return db.watchProgress.get(id)
}

export async function saveProgress(id: string, position: number, duration: number) {
  const completed = duration > 0 && position / duration > 0.9
  await db.watchProgress.put({ id, position, duration, lastWatched: Date.now(), completed })
}

export async function getRecentlyWatched(limit = 20): Promise<WatchProgress[]> {
  return db.watchProgress.orderBy('lastWatched').reverse().limit(limit).toArray()
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

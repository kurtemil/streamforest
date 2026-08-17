import Dexie, { type EntityTable } from 'dexie'
import type { Channel, WatchProgress, Favorite, PlaylistMeta, WatchLater, TmdbMeta, EpgProgram } from '@/types'
import { isCompleted } from '@/lib/progress'

interface EpgChannelName { id: string; channelId: string }

class AppDB extends Dexie {
  channels!: EntityTable<Channel, 'id'>
  watchProgress!: EntityTable<WatchProgress, 'id'>
  favorites!: EntityTable<Favorite, 'id'>
  playlistMeta!: EntityTable<PlaylistMeta, 'id'>
  watchLater!: EntityTable<WatchLater, 'id'>
  tmdbCache!: EntityTable<TmdbMeta, 'id'>
  epgPrograms!: EntityTable<EpgProgram, 'id'>
  epgChannelNames!: EntityTable<EpgChannelName, 'id'>

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
    this.version(4).stores({
      channels: 'id, type, groupTitle, showName, season, sortIndex',
      watchProgress: 'id, profileId, channelId, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
      watchLater: 'id, profileId, contentId, kind, addedAt',
    })
    this.version(5).stores({
      channels: 'id, type, groupTitle, showName, season, sortIndex',
      watchProgress: 'id, profileId, channelId, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
      watchLater: 'id, profileId, contentId, kind, addedAt',
      tmdbCache: 'id, contentType, tmdbId, cachedAt',
    })
    this.version(6).stores({
      channels: 'id, type, groupTitle, showName, season, sortIndex',
      watchProgress: 'id, profileId, channelId, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
      watchLater: 'id, profileId, contentId, kind, addedAt',
      tmdbCache: 'id, contentType, tmdbId, cachedAt',
      epgPrograms: 'id, channelId, start, end',
    })
    this.version(7).stores({
      channels: 'id, type, groupTitle, showName, season, sortIndex',
      watchProgress: 'id, profileId, channelId, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
      watchLater: 'id, profileId, contentId, kind, addedAt',
      tmdbCache: 'id, contentType, tmdbId, cachedAt',
      epgPrograms: 'id, channelId, start, end',
      epgChannelNames: 'id',
    })
  }
}

export const db = new AppDB()

export async function clearPlaylist() {
  await db.channels.clear()
  await db.playlistMeta.clear()
}

const SAVE_CHUNK = 2000

/**
 * Clear the old playlist, ready for entries to stream in.
 *
 * Split from the write itself because the worker delivers batches as it parses:
 * the table has to be emptied once at the start, not per batch, and the metadata
 * row is only meaningful once the whole file has landed.
 */
export async function startPlaylistSave(): Promise<void> {
  await db.channels.clear()
}

/** Record what was stored. Written last, so a half-finished import is visible as one. */
export async function finishPlaylistSave(channels: Channel[], url: string): Promise<void> {
  let movieCount = 0
  let seriesCount = 0
  let liveCount = 0
  for (const c of channels) {
    if (c.type === 'movie') movieCount++
    else if (c.type === 'series') seriesCount++
    else liveCount++
  }
  await db.playlistMeta.put({
    id: 1, url,
    fetchedAt: Date.now(),
    entryCount: channels.length,
    movieCount, seriesCount, liveCount,
  })
}

export async function saveChannels(
  channels: Channel[],
  url: string,
  onProgress?: (pct: number) => void,
) {
  await startPlaylistSave()
  for (let i = 0; i < channels.length; i += SAVE_CHUNK) {
    await db.channels.bulkPut(channels.slice(i, i + SAVE_CHUNK))
    onProgress?.(Math.min(99, Math.round(((i + SAVE_CHUNK) / channels.length) * 100)))
  }
  await finishPlaylistSave(channels, url)
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
  const completed = isCompleted(position, duration)
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

// ── TMDB cache ─────────────────────────────────────────────────────────────────

const TMDB_TTL_HIT     = 90 * 24 * 60 * 60 * 1000  // 90 days for found entries
const TMDB_TTL_MISS    =  1 * 24 * 60 * 60 * 1000  //  1 day for notFound entries (retry often)

export async function getTmdbMeta(id: string): Promise<TmdbMeta | undefined> {
  const rec = await db.tmdbCache.get(id)
  if (!rec) return undefined
  const ttl = rec.notFound ? TMDB_TTL_MISS : TMDB_TTL_HIT
  if (Date.now() - rec.cachedAt > ttl) {
    await db.tmdbCache.delete(id)
    return undefined
  }
  return rec
}

export async function getTmdbMetaBulk(ids: string[]): Promise<Map<string, TmdbMeta>> {
  const rows = await db.tmdbCache.where('id').anyOf(ids).toArray()
  const now = Date.now()
  const result = new Map<string, TmdbMeta>()
  for (const rec of rows) {
    const ttl = rec.notFound ? TMDB_TTL_MISS : TMDB_TTL_HIT
    if (now - rec.cachedAt <= ttl) result.set(rec.id, rec)
  }
  return result
}

export async function saveTmdbMeta(meta: TmdbMeta): Promise<void> {
  await db.tmdbCache.put(meta)
}

export async function clearTmdbNotFound(): Promise<number> {
  const ids = (await db.tmdbCache.filter((r) => !!r.notFound).primaryKeys()) as string[]
  await db.tmdbCache.bulkDelete(ids)
  return ids.length
}

// ── EPG cache ──────────────────────────────────────────────────────────────────

const EPG_SAVE_CHUNK = 5000

export async function saveEpgPrograms(programs: EpgProgram[]): Promise<void> {
  await db.epgPrograms.clear()
  for (let i = 0; i < programs.length; i += EPG_SAVE_CHUNK) {
    await db.epgPrograms.bulkPut(programs.slice(i, i + EPG_SAVE_CHUNK))
  }
}

export async function loadEpgFromDB(): Promise<Map<string, EpgProgram[]>> {
  const now = Date.now()
  // Drop programs that ended more than 2 hours ago
  const rows = await db.epgPrograms.where('end').above(now - 2 * 60 * 60 * 1000).toArray()
  const map = new Map<string, EpgProgram[]>()
  for (const p of rows) {
    const list = map.get(p.channelId) ?? []
    list.push(p)
    map.set(p.channelId, list)
  }
  // Sort each channel's programs by start time
  map.forEach((list) => list.sort((a, b) => a.start - b.start))
  return map
}

export async function clearEpgPrograms(): Promise<void> {
  await db.epgPrograms.clear()
}

export async function saveEpgChannelNames(map: Map<string, string>): Promise<void> {
  await db.epgChannelNames.clear()
  const rows = Array.from(map.entries()).map(([id, channelId]) => ({ id, channelId }))
  for (let i = 0; i < rows.length; i += EPG_SAVE_CHUNK) {
    await db.epgChannelNames.bulkPut(rows.slice(i, i + EPG_SAVE_CHUNK))
  }
}

export async function loadEpgChannelNames(): Promise<Map<string, string>> {
  const rows = await db.epgChannelNames.toArray()
  return new Map(rows.map((r) => [r.id, r.channelId]))
}

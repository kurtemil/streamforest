import Dexie, { type EntityTable } from 'dexie'
import type { Channel, WatchProgress, Favorite, PlaylistMeta, WatchLater, TmdbMeta, EpgProgram } from '@/types'
import { isCompleted } from '@/lib/progress'
import { normalizeShowKey } from '@/lib/utils'
import { pickRecentlyAdded } from '@/lib/recentlyAdded'

interface EpgChannelName { id: string; channelId: string }

/**
 * When this app first saw a channel id.
 *
 * Its own table because the channels table is emptied on every playlist import —
 * a diff against rows that are about to be deleted has nothing to compare with.
 * This one survives the import, which is the whole point of it.
 */
interface ChannelSeen { id: string; firstSeenAt: number }

/**
 * A title the person removed from History, so the home page stops recommending it.
 *
 * Recommendations are built by excluding what has been watched, which means
 * deleting the progress rows behind a History card hands the title straight back
 * to "Because you watched" — remove it and it starts being suggested. This table
 * is the memory of the removal that the progress table no longer holds.
 *
 * `key` is the same one the Library folds cards by: `show:<normalized>` for a
 * series, `ch:<id>` for a film. Nothing ever clears a row, and nothing needs to:
 * watching the title again writes progress, and progress excludes it from the
 * pool on its own.
 *
 * Local only. Progress deletion reaches D1, this does not, so a second device
 * can still recommend a title this one has dismissed until it is removed there
 * too. That needs a table and an endpoint it does not have yet.
 */
interface DismissedRec { id: string; profileId: string; key: string; addedAt: number }

class AppDB extends Dexie {
  channels!: EntityTable<Channel, 'id'>
  watchProgress!: EntityTable<WatchProgress, 'id'>
  favorites!: EntityTable<Favorite, 'id'>
  playlistMeta!: EntityTable<PlaylistMeta, 'id'>
  watchLater!: EntityTable<WatchLater, 'id'>
  tmdbCache!: EntityTable<TmdbMeta, 'id'>
  epgPrograms!: EntityTable<EpgProgram, 'id'>
  epgChannelNames!: EntityTable<EpgChannelName, 'id'>
  channelSeen!: EntityTable<ChannelSeen, 'id'>
  dismissedRecs!: EntityTable<DismissedRec, 'id'>

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
    this.version(8).stores({
      channels: 'id, type, groupTitle, showName, season, sortIndex',
      watchProgress: 'id, profileId, channelId, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
      watchLater: 'id, profileId, contentId, kind, addedAt',
      tmdbCache: 'id, contentType, tmdbId, cachedAt',
      epgPrograms: 'id, channelId, start, end',
      epgChannelNames: 'id',
      channelSeen: 'id, firstSeenAt',
    })
    this.version(9).stores({
      channels: 'id, type, groupTitle, showName, season, sortIndex',
      watchProgress: 'id, profileId, channelId, lastWatched, completed',
      favorites: 'id, kind, addedAt',
      playlistMeta: 'id',
      watchLater: 'id, profileId, contentId, kind, addedAt',
      tmdbCache: 'id, contentType, tmdbId, cachedAt',
      epgPrograms: 'id, channelId, start, end',
      epgChannelNames: 'id',
      channelSeen: 'id, firstSeenAt',
      dismissedRecs: 'id, profileId, addedAt',
    })
  }
}

export const db = new AppDB()

export async function clearPlaylist() {
  await db.channels.clear()
  await db.playlistMeta.clear()
  // The seen-history goes too. Keeping it would date the next import against a
  // library this install no longer has, and every title would come back "new"
  // except the ones that happen to match — which is worse than starting over.
  await db.channelSeen.clear()
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

/**
 * Stamp ids this app has not seen before, and forget the ones the provider
 * dropped.
 *
 * An M3U carries no date. Nothing in the file says when a title appeared, so
 * "Recently Added" was reading the only ordering there was — the order of lines
 * in the file — and calling it recency. That is why a Christmas film sat in the
 * row all year: it was never recent, it was near the top of the playlist.
 *
 * The one honest source is this app's own history, so it keeps one: an id it has
 * not stored before is new as of now. That makes the first run after this ships
 * a baseline of a single timestamp and nothing genuinely recent, which
 * `getRecentlyAddedIds` reports as empty rather than dressing up as a row.
 */
async function markSeen(channels: Channel[]): Promise<void> {
  const known = new Set(await db.channelSeen.toCollection().primaryKeys())
  const now = Date.now()
  const fresh: ChannelSeen[] = []
  const present = new Set<string>()
  for (const c of channels) {
    present.add(c.id)
    if (!known.has(c.id)) fresh.push({ id: c.id, firstSeenAt: now })
  }
  if (fresh.length) await db.channelSeen.bulkPut(fresh)
  // A title the provider removed and later restored should read as new again,
  // and without this the table grows for the life of the install.
  const gone = [...known].filter((id) => !present.has(id))
  if (gone.length) await db.channelSeen.bulkDelete(gone)
}

/**
 * Ids most recently added, newest first — empty when there is nothing to say.
 *
 * Returns a pool rather than a row's worth: callers split it into films and shows
 * and dedupe shows down to one episode each, so a fixed 20 here would arrive as
 * three after filtering.
 *
 * The oldest stamp in the table is the import that established the baseline;
 * everything carrying it arrived together and none of it is recent. `maxAgeDays`
 * stops a row that has not changed in half a year from still calling itself
 * recent.
 */
export async function getRecentlyAddedIds(pool = 240, maxAgeDays = 45): Promise<string[]> {
  // Newest first and capped: the whole table can be tens of thousands of rows,
  // and a row of twenty cards does not need any more than this to fill from.
  const rows = await db.channelSeen.orderBy('firstSeenAt').reverse().limit(pool).toArray()
  const oldest = await db.channelSeen.orderBy('firstSeenAt').first()
  if (!oldest) return []
  // The baseline may be older than anything in `rows`, so pass it in rather than
  // letting the pure function infer it from a slice that does not contain it.
  return pickRecentlyAdded([oldest, ...rows], Date.now(), maxAgeDays)
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
  await markSeen(channels)
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

/**
 * Forget a title outright: every progress row behind it, not just one.
 *
 * A History card stands for a whole show — the tab dedupes by `normalizeShowKey`
 * and shows the most recent episode — so deleting the one row it was built from
 * only reveals the next episode down and the card comes back. It also has to be
 * all of them for the delete to mean anything beyond the tab: "Because you
 * watched" reads the same table, and one surviving episode is enough to keep
 * recommending from a show the person just said they were done with.
 */
export async function clearProgressMany(profileId: string, channelIds: string[]) {
  if (!channelIds.length) return
  await db.watchProgress.bulkDelete(channelIds.map((id) => `${profileId}:${id}`))
}

/** The dedupe key a title is known by in the Library and in recommendations. */
export function recommendationKey(ch: { type: string; id: string; showName?: string | null }): string {
  return ch.type === 'series' && ch.showName ? `show:${normalizeShowKey(ch.showName)}` : `ch:${ch.id}`
}

export async function dismissRecommendation(profileId: string, key: string) {
  await db.dismissedRecs.put({ id: `${profileId}:${key}`, profileId, key, addedAt: Date.now() })
}

export async function getDismissedRecKeys(profileId: string): Promise<string[]> {
  return (await db.dismissedRecs.where('profileId').equals(profileId).toArray()).map((r) => r.key)
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

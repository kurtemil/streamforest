import { useMemo, type MouseEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { Bookmark, Film, Tv } from 'lucide-react'
import { normalizeShowKey } from '@/lib/utils'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useProfileStore } from '@/stores/profileStore'
import { db, addToWatchLater, removeFromWatchLater } from '@/services/db'
import { pushWatchLater, deleteRemoteWatchLater } from '@/services/sync'
import { MovieCard } from '@/components/movies/MovieCard'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Channel, WatchLater } from '@/types'
import { useT } from '@/lib/i18n'

export function WatchLaterPage() {
  const t = useT()
  const navigate = useNavigate()
  const { channels } = usePlaylistStore()
  const { play } = usePlayerStore()
  const { activeProfileId } = useProfileStore()

  const watchLaterEntries = useLiveQuery(async () => {
    if (!activeProfileId) return []
    const rows = await db.watchLater.where('profileId').equals(activeProfileId).toArray()
    return rows.sort((a, b) => b.addedAt - a.addedAt)
  }, [activeProfileId])

  const watchLaterSet = useMemo(
    () => new Set(watchLaterEntries?.map((e) => e.contentId) ?? []),
    [watchLaterEntries]
  )

  const { movies, shows } = useMemo(() => {
    if (!watchLaterEntries || !channels.length) return { movies: [], shows: [] }

    const chanById = new Map(channels.map((c) => [c.id, c]))
    const showRepMap = new Map<string, Channel>()
    for (const ch of channels) {
      if (ch.type === 'series' && ch.showName) {
        const key = normalizeShowKey(ch.showName)
        if (!showRepMap.has(key)) showRepMap.set(key, ch)
      }
    }

    const movies: { entry: WatchLater; channel: Channel }[] = []
    const shows: { entry: WatchLater; channel: Channel }[] = []

    for (const entry of watchLaterEntries) {
      if (entry.kind === 'movie') {
        const ch = chanById.get(entry.contentId)
        if (ch) movies.push({ entry, channel: ch })
      } else {
        const ch = showRepMap.get(entry.contentId)
        if (ch) shows.push({ entry, channel: ch })
      }
    }

    return { movies, shows }
  }, [watchLaterEntries, channels])

  const toggleWatchLater = async (contentId: string, kind: 'movie' | 'series', e: MouseEvent) => {
    e.stopPropagation()
    if (!activeProfileId) return
    if (watchLaterSet.has(contentId)) {
      await removeFromWatchLater(activeProfileId, contentId)
      deleteRemoteWatchLater(activeProfileId, contentId)
    } else {
      const entry = await addToWatchLater(activeProfileId, contentId, kind)
      pushWatchLater(entry)
    }
  }

  const totalCount = (watchLaterEntries?.length ?? 0)

  if (totalCount === 0) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<Bookmark size={40} />}
          title={t('library.emptyWatchLaterTitle')}
          description={t('library.emptyWatchLaterBody')}
        />
      </div>
    )
  }

  return (
    <div className="p-6 pb-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-white">{t('common.watchLater')}</h1>
        <p className="text-neutral-500 text-sm">{t('movies.count', { count: totalCount })}</p>
      </div>

      {movies.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Film size={16} className="text-neutral-400" />
            <h2 className="text-base font-semibold text-white">{t('common.movies')}</h2>
            <span className="text-xs text-neutral-600 ml-1">{movies.length}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {movies.map(({ entry, channel }) => (
              <MovieCard
                key={entry.id}
                channel={channel}
                isWatchLater
                onClick={() => { navigate(`/movies?playing=${channel.id}`); play(channel) }}
                onWatchLater={(e) => toggleWatchLater(entry.contentId, 'movie', e)}
              />
            ))}
          </div>
        </section>
      )}

      {shows.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Tv size={16} className="text-neutral-400" />
            <h2 className="text-base font-semibold text-white">{t('common.tvShows')}</h2>
            <span className="text-xs text-neutral-600 ml-1">{shows.length}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {shows.map(({ entry, channel }) => {
              const showKey = normalizeShowKey(channel.showName ?? channel.name)
              return (
                <MovieCard
                  key={entry.id}
                  channel={channel}
                  isWatchLater
                  onClick={() => navigate(`/series?show=${encodeURIComponent(showKey)}`)}
                  onWatchLater={(e) => toggleWatchLater(entry.contentId, 'series', e)}
                />
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

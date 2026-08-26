import { useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { normalizeShowKey } from '@/lib/utils'
import { Settings } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useProfileStore } from '@/stores/profileStore'
import { useActiveExclusions } from '@/hooks/useActiveExclusions'
import { db, clearProgress, addToWatchLater, removeFromWatchLater, getRecentlyAddedIds, getDismissedRecKeys } from '@/services/db'
import { deleteRemoteProgress, pushWatchLater, deleteRemoteWatchLater } from '@/services/sync'
import { MovieCard } from '@/components/movies/MovieCard'
import { Hero } from '@/components/home/Hero'
import { MovieDetailModal } from '@/components/home/MovieDetailModal'
import { ScrollableRow, SectionHeader } from '@/components/ui/MediaRow'
import { ContinueCard } from '@/components/ui/ContinueCard'
import type { Channel, WatchProgress, TmdbMeta } from '@/types'
import { useTmdbEnrich } from '@/hooks/useTmdbEnrich'
import { useT } from '@/lib/i18n'

export function HomePage() {
  const t = useT()
  const navigate = useNavigate()
  const { channels, loaded, m3uUrl } = usePlaylistStore()
  const { play } = usePlayerStore()
  const { activeProfileId } = useProfileStore()

  const [detailChannel, setDetailChannel] = useState<Channel | null>(null)
  const [detailTmdb, setDetailTmdb] = useState<TmdbMeta | null>(null)

  const excluded = useActiveExclusions()
  const movies = useMemo(
    () => channels.filter((c) => c.type === 'movie' && !excluded.movie.has(c.groupTitle)),
    [channels, excluded.movie],
  )
  const series = useMemo(
    () => channels.filter((c) => c.type === 'series' && !excluded.series.has(c.groupTitle)),
    [channels, excluded.series],
  )

  const recentProgress = useLiveQuery(async () => {
    if (!activeProfileId) return []
    const all = await db.watchProgress.where('profileId').equals(activeProfileId).toArray()
    return all.sort((a, b) => b.lastWatched - a.lastWatched).slice(0, 40)
  }, [activeProfileId])

  // Titles removed from Library → History. They carry no progress any more, which
  // is exactly why they need their own list: the recommendation pool is built by
  // excluding what has been watched, so without this a removed title would come
  // back as a suggestion the moment its progress was deleted.
  const dismissedRecKeys = useLiveQuery(async () => {
    if (!activeProfileId) return new Set<string>()
    return new Set(await getDismissedRecKeys(activeProfileId))
  }, [activeProfileId])

  // Index the profile's whole progress table, rather than asking about the first
  // 500 channels. The old query built one key per channel and capped the list, so
  // in a library of tens of thousands nothing past position 500 could ever show a
  // progress bar. There are at most a few hundred progress rows, which is the
  // smaller side of the join by orders of magnitude.
  const progressMap = useLiveQuery(async () => {
    if (!activeProfileId) return {}
    const rows = await db.watchProgress.where('profileId').equals(activeProfileId).toArray()
    return Object.fromEntries(rows.map((r) => [r.channelId, r]))
  }, [activeProfileId])

  const continueWatching = useMemo(() => {
    if (!recentProgress || !channels.length) return []
    const chanById = new Map(channels.map((c) => [c.id, c]))
    return recentProgress
      .filter((p) => !p.completed && p.position > 10)
      .map((p) => ({ progress: p, channel: chanById.get(p.channelId) }))
      .filter(
        (x): x is { progress: WatchProgress; channel: Channel } => x.channel !== undefined,
      )
      .slice(0, 12)
  }, [recentProgress, channels])

  const watchLaterEntries = useLiveQuery(async () => {
    if (!activeProfileId) return []
    return db.watchLater.where('profileId').equals(activeProfileId).toArray()
  }, [activeProfileId])

  const watchLaterSet = useMemo(
    () => new Set(watchLaterEntries?.map((e) => e.contentId) ?? []),
    [watchLaterEntries],
  )

  const toggleWatchLater = useCallback(
    async (contentId: string, kind: 'movie' | 'series', e: React.MouseEvent) => {
      e.stopPropagation()
      if (!activeProfileId) return
      if (watchLaterSet.has(contentId)) {
        await removeFromWatchLater(activeProfileId, contentId)
        deleteRemoteWatchLater(activeProfileId, contentId)
      } else {
        const entry = await addToWatchLater(activeProfileId, contentId, kind)
        pushWatchLater(entry)
      }
    },
    [activeProfileId, watchLaterSet],
  )

  // What is actually new, not what is near the top of the playlist file. An M3U
  // has no dates, so `movies.slice(0, 20)` was reading line order as recency —
  // which is why the same handful of titles sat here for months. The app stamps
  // ids it has not seen before on each import; this is that history, and it is
  // empty until an import brings something the previous one did not have.
  const recentIds = useLiveQuery(() => getRecentlyAddedIds(), [])

  const recentMovies = useMemo(() => {
    if (!recentIds?.length || !movies.length) return []
    const byId = new Map(movies.map((m) => [m.id, m]))
    const result: Channel[] = []
    for (const id of recentIds) {
      const m = byId.get(id)
      if (m) result.push(m)
      if (result.length >= 20) break
    }
    return result
  }, [recentIds, movies])

  const recentShows = useMemo(() => {
    if (!recentIds?.length || !series.length) return []
    const byId = new Map(series.map((c) => [c.id, c]))
    // One card per show: a new season arrives as a dozen episodes and would
    // otherwise fill the whole row with the same title.
    const seen = new Set<string>()
    const result: Channel[] = []
    for (const id of recentIds) {
      const ch = byId.get(id)
      if (!ch) continue
      const key = ch.showName ?? ch.name
      if (seen.has(key)) continue
      seen.add(key)
      result.push(ch)
      if (result.length >= 20) break
    }
    return result
  }, [recentIds, series])

  // Top movie genre rows (top 3 by count, 20 items each)
  const movieGenreRows = useMemo(() => {
    const byGroup = new Map<string, Channel[]>()
    for (const m of movies) {
      if (!byGroup.has(m.groupTitle)) byGroup.set(m.groupTitle, [])
      byGroup.get(m.groupTitle)!.push(m)
    }
    return Array.from(byGroup.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3)
      .map(([rawTitle, items]) => ({
        rawTitle,
        title: rawTitle.replace(/^VOD:\s*/, ''),
        items: items.slice(0, 20),
      }))
  }, [movies])

  // Top show genre rows (top 3 by show count, 20 shows each)
  const showGenreRows = useMemo(() => {
    const byGroup = new Map<string, Channel[]>()
    for (const ch of series) {
      if (!byGroup.has(ch.groupTitle)) byGroup.set(ch.groupTitle, [])
      byGroup.get(ch.groupTitle)!.push(ch)
    }
    return Array.from(byGroup.entries())
      .sort((a, b) => {
        const aCount = new Set(b[1].map((c) => normalizeShowKey(c.showName ?? c.name))).size
        const bCount = new Set(a[1].map((c) => normalizeShowKey(c.showName ?? c.name))).size
        return aCount - bCount
      })
      .slice(0, 3)
      .map(([rawTitle, chs]) => {
        const seen = new Set<string>()
        const items: Channel[] = []
        for (const ch of chs) {
          const key = normalizeShowKey(ch.showName ?? ch.name)
          if (!seen.has(key)) {
            seen.add(key)
            items.push(ch)
          }
          if (items.length >= 20) break
        }
        return { rawTitle, title: rawTitle.replace(/^Series:\s*/, ''), items }
      })
  }, [series])

  // "Because you watched X"
  const recommendations = useMemo(() => {
    if (!recentProgress?.length || !channels.length) return null
    const chanById = new Map(channels.map((c) => [c.id, c]))

    const watchedChannels = recentProgress
      .filter((p) => p.completed || (p.duration > 0 && p.position / p.duration > 0.5))
      .map((p) => chanById.get(p.channelId))
      .filter(Boolean) as Channel[]

    if (!watchedChannels.length) return null

    const source = watchedChannels[0]
    const sourceKey =
      source.type === 'series' && source.showName
        ? normalizeShowKey(source.showName)
        : source.id

    const watchedIds = new Set(watchedChannels.map((c) => c.id))
    const watchedShowKeys = new Set(
      watchedChannels.map((c) =>
        c.type === 'series' && c.showName ? normalizeShowKey(c.showName) : c.id,
      ),
    )

    const dismissed = dismissedRecKeys ?? new Set<string>()
    const pool: Channel[] = []
    for (const m of movies) {
      if (!watchedIds.has(m.id) && !dismissed.has(`ch:${m.id}`)) pool.push(m)
    }
    const seenShows = new Set<string>()
    for (const ch of series) {
      const k = normalizeShowKey(ch.showName ?? ch.name)
      if (!seenShows.has(k) && !watchedShowKeys.has(k) && !dismissed.has(`show:${k}`)) {
        seenShows.add(k)
        pool.push(ch)
      }
    }

    const sameGroup = pool.filter((c) => c.groupTitle === source.groupTitle)
    const candidates = sameGroup.length >= 4 ? sameGroup : pool
    if (!candidates.length) return null

    const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, 16)
    const title = source.movieTitle ?? source.showName ?? source.name
    return { title, sourceKey, items: shuffled }
  }, [recentProgress, channels, movies, series, dismissedRecKeys])

  const enrichTargets = useMemo(
    () => [
      ...continueWatching.map((x) => x.channel),
      ...recentMovies,
      ...recentShows,
      ...(recommendations?.items ?? []),
      ...movieGenreRows.flatMap((r) => r.items),
      ...showGenreRows.flatMap((r) => r.items),
    ],
    [continueWatching, recentMovies, recentShows, recommendations, movieGenreRows, showGenreRows],
  )
  const tmdbMap = useTmdbEnrich(enrichTargets)

  // TMDB genre rows for movies — populates progressively as enrichment happens
  const tmdbMovieGenreRows = useMemo(() => {
    const byGenre = new Map<string, Channel[]>()
    for (const m of movies) {
      const meta = tmdbMap.get(m.id)
      if (!meta || meta.notFound || !meta.genres?.length) continue
      for (const genre of meta.genres.slice(0, 3)) {
        if (!byGenre.has(genre)) byGenre.set(genre, [])
        byGenre.get(genre)!.push(m)
      }
    }
    return Array.from(byGenre.entries())
      .filter(([, items]) => items.length >= 3)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 4)
      .map(([genre, items]) => ({ genre, items: items.slice(0, 20) }))
  }, [movies, tmdbMap])

  // TMDB genre rows for shows
  const tmdbShowGenreRows = useMemo(() => {
    const byGenre = new Map<string, Channel[]>()
    const seenShows = new Set<string>()
    // Use recentShows + showGenreRows items (all are show representatives)
    const showItems = [
      ...recentShows,
      ...showGenreRows.flatMap((r) => r.items),
    ]
    for (const ch of showItems) {
      const showKey = normalizeShowKey(ch.showName ?? ch.name)
      const meta = tmdbMap.get(showKey)
      if (!meta || meta.notFound || !meta.genres?.length) continue
      for (const genre of meta.genres.slice(0, 3)) {
        if (!byGenre.has(genre)) byGenre.set(genre, [])
        // Deduplicate shows within genre
        if (!seenShows.has(`${genre}:${showKey}`)) {
          seenShows.add(`${genre}:${showKey}`)
          byGenre.get(genre)!.push(ch)
        }
      }
    }
    return Array.from(byGenre.entries())
      .filter(([, items]) => items.length >= 3)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 4)
      .map(([genre, items]) => ({ genre, items: items.slice(0, 20) }))
  }, [recentShows, showGenreRows, tmdbMap])

  const heroItems = useMemo(() => {
    const candidates: Array<{ channel: Channel; tmdbMeta: TmdbMeta }> = []
    for (const ch of [...recentMovies, ...recentShows]) {
      const key =
        ch.type === 'series' && ch.showName ? normalizeShowKey(ch.showName) : ch.id
      const meta = tmdbMap.get(key)
      // A poster is enough — Hero blurs it into a backdrop when no landscape art
      // exists. Requiring backdropPath meant the hero silently vanished for whole
      // libraries and the home screen opened on a row heading.
      // Any picture will do. Hero prefers a landscape backdrop, falls back to the
      // poster blurred into one, and finally to whatever artwork the playlist
      // itself carries. Requiring backdropPath meant the hero silently vanished
      // for whole libraries and the home screen opened on a row heading.
      if (meta && !meta.notFound && (meta.backdropPath || meta.posterPath || ch.logo)) {
        candidates.push({ channel: ch, tmdbMeta: meta })
      }
      if (candidates.length >= 8) break
    }
    return candidates
  }, [recentMovies, recentShows, tmdbMap])

  if (!loaded) return null

  if (!m3uUrl || channels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
        <div className="w-16 h-16 rounded-2xl bg-accent-600/20 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8">
            <path d="M5 3l14 9-14 9V3z" fill="#16a34a" />
          </svg>
        </div>
        <div className="text-center max-w-sm">
          <h1 className="text-heading-xl text-white mb-2">{t('home.welcomeTitle')}</h1>
          <p className="text-neutral-400 text-body leading-relaxed">{t('home.welcomeBody')}</p>
        </div>
        <Link
          to="/settings"
          className="flex items-center gap-2 px-5 py-2.5 bg-accent-600 hover:bg-accent-500 rounded-lg text-white text-body font-medium transition-colors"
        >
          <Settings size={15} />
          {t('home.openSettings')}
        </Link>
      </div>
    )
  }

  return (
    <>
      {heroItems.length > 0 && (
        <Hero
          items={heroItems}
          onPlay={(ch) => {
            if (ch.type === 'movie') navigate(`/movies?playing=${ch.id}`)
            else if (ch.type === 'series')
              navigate(
                `/series?show=${encodeURIComponent(normalizeShowKey(ch.showName ?? ch.name))}`,
              )
            play(ch)
          }}
          onMoreInfo={(ch) => {
            const key =
              ch.type === 'series' && ch.showName ? normalizeShowKey(ch.showName) : ch.id
            setDetailChannel(ch)
            setDetailTmdb(tmdbMap.get(key) ?? null)
          }}
          onWatchLater={(ch) => {
            if (!activeProfileId) return
            const id =
              ch.type === 'series' && ch.showName ? normalizeShowKey(ch.showName) : ch.id
            const kind: 'movie' | 'series' = ch.type === 'series' ? 'series' : 'movie'
            if (watchLaterSet.has(id)) {
              removeFromWatchLater(activeProfileId, id)
              deleteRemoteWatchLater(activeProfileId, id)
            } else {
              addToWatchLater(activeProfileId, id, kind).then(pushWatchLater)
            }
          }}
          isWatchLater={(ch) => {
            const id =
              ch.type === 'series' && ch.showName ? normalizeShowKey(ch.showName) : ch.id
            return watchLaterSet.has(id)
          }}
        />
      )}

      <div className="px-4 sm:px-6 pb-12 pt-6 space-y-8 sm:space-y-10">
        {/* Recently Added Movies */}
        {recentMovies.length > 0 && (
          <section>
            <SectionHeader title={t('home.recentMovies')} to="/movies" />
            <ScrollableRow>
              {recentMovies.map((m) => (
                <div key={m.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                  <MovieCard
                    channel={m}
                    progress={progressMap?.[m.id]}
                    isWatchLater={watchLaterSet.has(m.id)}
                    tmdbMeta={tmdbMap.get(m.id)}
                    onClick={() => {
                      setDetailChannel(m)
                      setDetailTmdb(tmdbMap.get(m.id) ?? null)
                    }}
                    onWatchLater={(e) => toggleWatchLater(m.id, 'movie', e)}
                  />
                </div>
              ))}
            </ScrollableRow>
          </section>
        )}

        {/* Recently Added TV Shows */}
        {recentShows.length > 0 && (
          <section>
            <SectionHeader title={t('home.recentShows')} to="/series" />
            <ScrollableRow>
              {recentShows.map((ch) => {
                const showKey = normalizeShowKey(ch.showName ?? ch.name)
                const episodeLabel =
                  ch.season != null && ch.episode != null
                    ? `S${String(ch.season).padStart(2, '0')}E${String(ch.episode).padStart(2, '0')}${ch.episodeTitle ? ` · ${ch.episodeTitle}` : ''}`
                    : undefined
                return (
                  <div key={ch.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                    <MovieCard
                      channel={ch}
                      progress={progressMap?.[ch.id]}
                      isWatchLater={watchLaterSet.has(showKey)}
                      tmdbMeta={tmdbMap.get(showKey)}
                      episodeLabel={episodeLabel}
                      onClick={() => {
                        navigate(
                          `/series?show=${encodeURIComponent(showKey)}&playing=${ch.id}`,
                        )
                        play(ch)
                      }}
                      onWatchLater={(e) => toggleWatchLater(showKey, 'series', e)}
                    />
                  </div>
                )
              })}
            </ScrollableRow>
          </section>
        )}

        {/* Continue Watching — a row among the others, after the new arrivals */}
        {continueWatching.length > 0 && (
          <section>
            <SectionHeader title={t('common.continueWatching')} />
            <ScrollableRow>
              {continueWatching.map(({ channel, progress }) => {
                const tmdbKey =
                  channel.type === 'series' && channel.showName
                    ? normalizeShowKey(channel.showName)
                    : channel.id
                return (
                  <div key={channel.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                    <ContinueCard
                      channel={channel}
                      progress={progress}
                      tmdbMeta={tmdbMap.get(tmdbKey)}
                      onClick={() => {
                        if (channel.type === 'movie')
                          navigate(`/movies?playing=${channel.id}`)
                        else if (channel.type === 'series')
                          navigate(
                            `/series?show=${encodeURIComponent(normalizeShowKey(channel.showName ?? channel.name))}&playing=${channel.id}`,
                          )
                        play(channel)
                      }}
                      onRemove={() => {
                        if (activeProfileId) {
                          clearProgress(activeProfileId, channel.id)
                          deleteRemoteProgress(activeProfileId, channel.id)
                        }
                      }}
                    />
                  </div>
                )
              })}
            </ScrollableRow>
          </section>
        )}

        {/* Because you watched X */}
        {recommendations && recommendations.items.length > 0 && (
          <section>
            <SectionHeader
              title={t('home.becauseYouWatched', {
                title: tmdbMap.get(recommendations.sourceKey)?.title ?? recommendations.title,
              })}
            />
            <ScrollableRow>
              {recommendations.items.map((ch) => {
                const key =
                  ch.type === 'series' && ch.showName
                    ? normalizeShowKey(ch.showName)
                    : ch.id
                return (
                  <div key={ch.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                    <MovieCard
                      channel={ch}
                      tmdbMeta={tmdbMap.get(key)}
                      isWatchLater={watchLaterSet.has(key)}
                      onClick={() => {
                        if (ch.type === 'series' && ch.showName) {
                          navigate(
                            `/series?show=${encodeURIComponent(normalizeShowKey(ch.showName))}`,
                          )
                        } else {
                          setDetailChannel(ch)
                          setDetailTmdb(tmdbMap.get(key) ?? null)
                        }
                      }}
                      onWatchLater={(e) =>
                        toggleWatchLater(key, ch.type === 'series' ? 'series' : 'movie', e)
                      }
                    />
                  </div>
                )
              })}
            </ScrollableRow>
          </section>
        )}

        {/* TMDB movie genre rows (Action, Drama, etc.) */}
        {tmdbMovieGenreRows.map(({ genre, items }) => (
          <section key={`tmdb-movie-${genre}`}>
            <SectionHeader
              title={genre}
              onSeeAll={() => navigate('/movies')}
            />
            <ScrollableRow>
              {items.map((m) => (
                <div key={m.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                  <MovieCard
                    channel={m}
                    progress={progressMap?.[m.id]}
                    isWatchLater={watchLaterSet.has(m.id)}
                    tmdbMeta={tmdbMap.get(m.id)}
                    onClick={() => {
                      setDetailChannel(m)
                      setDetailTmdb(tmdbMap.get(m.id) ?? null)
                    }}
                    onWatchLater={(e) => toggleWatchLater(m.id, 'movie', e)}
                  />
                </div>
              ))}
            </ScrollableRow>
          </section>
        ))}

        {/* TMDB show genre rows */}
        {tmdbShowGenreRows.map(({ genre, items }) => (
          <section key={`tmdb-show-${genre}`}>
            <SectionHeader
              title={genre}
              onSeeAll={() => navigate('/series')}
            />
            <ScrollableRow>
              {items.map((ch) => {
                const showKey = normalizeShowKey(ch.showName ?? ch.name)
                return (
                  <div key={ch.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                    <MovieCard
                      channel={ch}
                      isWatchLater={watchLaterSet.has(showKey)}
                      tmdbMeta={tmdbMap.get(showKey)}
                      onClick={() => navigate(`/series?show=${encodeURIComponent(showKey)}`)}
                      onWatchLater={(e) => toggleWatchLater(showKey, 'series', e)}
                    />
                  </div>
                )
              })}
            </ScrollableRow>
          </section>
        ))}

        {/* M3U movie group rows */}
        {movieGenreRows.map(({ rawTitle, title, items }) => (
          <section key={rawTitle}>
            <SectionHeader
              title={title}
              onSeeAll={() => navigate(`/movies?group=${encodeURIComponent(rawTitle)}`)}
            />
            <ScrollableRow>
              {items.map((m) => (
                <div key={m.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                  <MovieCard
                    channel={m}
                    progress={progressMap?.[m.id]}
                    isWatchLater={watchLaterSet.has(m.id)}
                    tmdbMeta={tmdbMap.get(m.id)}
                    onClick={() => {
                      setDetailChannel(m)
                      setDetailTmdb(tmdbMap.get(m.id) ?? null)
                    }}
                    onWatchLater={(e) => toggleWatchLater(m.id, 'movie', e)}
                  />
                </div>
              ))}
            </ScrollableRow>
          </section>
        ))}

        {/* Show genre rows */}
        {showGenreRows.map(({ rawTitle, title, items }) => (
          <section key={rawTitle}>
            <SectionHeader
              title={title}
              onSeeAll={() => navigate(`/series?group=${encodeURIComponent(rawTitle)}`)}
            />
            <ScrollableRow>
              {items.map((ch) => {
                const showKey = normalizeShowKey(ch.showName ?? ch.name)
                return (
                  <div key={ch.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                    <MovieCard
                      channel={ch}
                      isWatchLater={watchLaterSet.has(showKey)}
                      tmdbMeta={tmdbMap.get(showKey)}
                      onClick={() =>
                        navigate(`/series?show=${encodeURIComponent(showKey)}`)
                      }
                      onWatchLater={(e) => toggleWatchLater(showKey, 'series', e)}
                    />
                  </div>
                )
              })}
            </ScrollableRow>
          </section>
        ))}
      </div>

      <MovieDetailModal
        channel={detailChannel}
        tmdbMeta={detailTmdb}
        isWatchLater={
          detailChannel
            ? watchLaterSet.has(
                detailChannel.type === 'series' && detailChannel.showName
                  ? normalizeShowKey(detailChannel.showName)
                  : detailChannel.id,
              )
            : false
        }
        onClose={() => {
          setDetailChannel(null)
          setDetailTmdb(null)
        }}
        onPlay={() => {
          if (!detailChannel) return
          if (detailChannel.type === 'movie') navigate(`/movies?playing=${detailChannel.id}`)
          else
            navigate(
              `/series?show=${encodeURIComponent(normalizeShowKey(detailChannel.showName ?? detailChannel.name))}`,
            )
          play(detailChannel)
          setDetailChannel(null)
          setDetailTmdb(null)
        }}
        onWatchLater={() => {
          if (!detailChannel || !activeProfileId) return
          const id =
            detailChannel.type === 'series' && detailChannel.showName
              ? normalizeShowKey(detailChannel.showName)
              : detailChannel.id
          const kind: 'movie' | 'series' = detailChannel.type === 'series' ? 'series' : 'movie'
          if (watchLaterSet.has(id)) {
            removeFromWatchLater(activeProfileId, id)
            deleteRemoteWatchLater(activeProfileId, id)
          } else {
            addToWatchLater(activeProfileId, id, kind).then(pushWatchLater)
          }
        }}
      />
    </>
  )
}

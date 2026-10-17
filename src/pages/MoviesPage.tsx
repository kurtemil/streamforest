import { useState, useMemo, useRef, useEffect, useCallback, type MouseEvent } from 'react'
import type { Channel, WatchProgress } from '@/types'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router-dom'
import { Film, Shuffle } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useProfileStore } from '@/stores/profileStore'
import { useActiveExclusions } from '@/hooks/useActiveExclusions'
import {
  db,
  addToWatchLater,
  removeFromWatchLater,
  clearProgress,
  getRecentlyAddedIds,
} from '@/services/db'
import { pushWatchLater, deleteRemoteWatchLater, deleteRemoteProgress } from '@/services/sync'
import { MovieCard } from '@/components/movies/MovieCard'
import { useDetailStore } from '@/stores/detailStore'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { GroupSidebar } from '@/components/ui/GroupSidebar'
import { ScrollableRow, SectionHeader } from '@/components/ui/MediaRow'
import { ContinueCard } from '@/components/ui/ContinueCard'
import { useTmdbEnrich } from '@/hooks/useTmdbEnrich'
import { useBecauseYouWatched, type RecSource } from '@/hooks/useBecauseYouWatched'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { formatNumber, useLocale, useT } from '@/lib/i18n'
import { GenreChips, type Genre } from '@/components/ui/GenreChips'
import { useCatalogMovies, useHeroItems } from '@/hooks/useCatalogList'
import { Hero } from '@/components/home/Hero'
import { discoverByGenre, fetchGenres } from '@/services/tmdb'

const ENRICH_LIMIT = 200
/** Grid rows enriched beyond the ones rendered, so artwork is there on arrival. */
const ENRICH_AHEAD = 40
const cleanGroup = (t: string) => t.replace(/^VOD:\s*/, '')

export function MoviesPage() {
  const t = useT()
  const [searchParams] = useSearchParams()
  const { channels } = usePlaylistStore()
  const { play } = usePlayerStore()
  const [search, setSearch] = useState('')
  // Genre filter (feedback-box suggestion). TMDB has the genres; the catalogue has
  // none, so a genre shows TMDB's most popular titles in it that are here.
  const locale = useLocale()
  const [genre, setGenre] = useState<Genre | null>(null)
  const [genres, setGenres] = useState<Genre[]>([])
  useEffect(() => {
    let alive = true
    fetchGenres('movie', locale).then((g) => { if (alive) setGenres(g) })
    return () => { alive = false }
  }, [locale])
  const genreList = useCatalogMovies(
    genre ? () => discoverByGenre('movie', genre.id, locale) : null,
    genre ? `movie-genre-${genre.id}@${locale}` : 'none',
  )
  const [selectedGroup, setSelectedGroup] = useState<string | null>(
    () => searchParams.get('group'),
  )

  useEffect(() => {
    const g = searchParams.get('group')
    if (g !== null) setSelectedGroup(g)
  }, [searchParams])

  const { activeProfileId } = useProfileStore()
  const { movie: excludedMovies } = useActiveExclusions()
  const movies = useMemo(
    () => channels.filter((c) => c.type === 'movie' && !excludedMovies.has(c.groupTitle)),
    [channels, excludedMovies],
  )

  const isRowMode = !search.trim() && selectedGroup === null && !genre

  const didAutoPlay = useRef(false)
  useEffect(() => {
    if (didAutoPlay.current || !movies.length) return
    didAutoPlay.current = true
    const playingId = searchParams.get('playing')
    if (!playingId) return
    const movie = movies.find((m) => m.id === playingId)
    if (movie) play(movie)
  }, [movies, searchParams, play])

  const groups = useMemo(() => {
    const seen = new Set<string>()
    const counts = new Map<string, number>()
    for (const m of movies) {
      if (!seen.has(m.groupTitle)) seen.add(m.groupTitle)
      counts.set(m.groupTitle, (counts.get(m.groupTitle) ?? 0) + 1)
    }
    return Array.from(seen).map((title) => ({ title, count: counts.get(title) ?? 0 }))
  }, [movies])

  // Same history the home screen reads: ids this app first saw on an import that
  // brought them, rather than the first twenty lines of the playlist file.
  const recentIds = useLiveQuery(() => getRecentlyAddedIds(), [])
  const recentlyAdded = useMemo(() => {
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

  const filtered = useMemo(() => {
    if (genre) {
      const base = genreList.matches.map((x) => x.channel)
      const q = search.trim().toLowerCase()
      return q ? base.filter((m) => (m.movieTitle ?? m.name).toLowerCase().includes(q)) : base
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      return movies.filter((m) => (m.movieTitle ?? m.name).toLowerCase().includes(q))
    }
    if (selectedGroup !== null) return movies.filter((m) => m.groupTitle === selectedGroup)
    return movies.slice(0, 200)
  }, [movies, selectedGroup, search, genre, genreList.matches])

  const recentProgress = useLiveQuery(async () => {
    if (!activeProfileId) return []
    const all = await db.watchProgress.where('profileId').equals(activeProfileId).toArray()
    return all.sort((a, b) => b.lastWatched - a.lastWatched)
  }, [activeProfileId])

  const continueWatchingMovies = useMemo(() => {
    if (!recentProgress?.length || !movies.length) return []
    const movieIds = new Set(movies.map((m) => m.id))
    const chanById = new Map(movies.map((m) => [m.id, m]))
    return recentProgress
      .filter((p) => movieIds.has(p.channelId) && !p.completed && p.position > 10)
      .map((p) => ({ progress: p as WatchProgress, channel: chanById.get(p.channelId)! }))
      .filter((x) => !!x.channel)
      .slice(0, 12)
  }, [recentProgress, movies])

  // M3U group rows (top 6 by size)
  const groupRows = useMemo(() => {
    if (!isRowMode) return []
    const byGroup = new Map<string, Channel[]>()
    for (const m of movies) {
      if (!byGroup.has(m.groupTitle)) byGroup.set(m.groupTitle, [])
      byGroup.get(m.groupTitle)!.push(m)
    }
    return Array.from(byGroup.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([rawTitle, items]) => ({
        rawTitle,
        title: cleanGroup(rawTitle),
        items: items.slice(0, 20),
      }))
  }, [movies, isRowMode])

  // The profile's whole progress table, indexed once. Querying by the visible
  // channel ids meant building a key per card and capping the list, so a filtered
  // grid deep in the library showed no progress at all — and the query re-ran on
  // every keystroke, because `filtered` changes with the search box.
  const progressMap = useLiveQuery(async () => {
    if (!activeProfileId) return {}
    const rows = await db.watchProgress.where('profileId').equals(activeProfileId).toArray()
    return Object.fromEntries(rows.map((r) => [r.channelId, r]))
  }, [activeProfileId])

  const { count, sentinelRef, reset } = useInfiniteScroll(filtered.length)

  // "Since you watched X": the film most recently watched through (or past half).
  // The row itself is TMDB's recommendations for it (useBecauseYouWatched).
  const recSource = useMemo((): (RecSource & { watchedIds: Set<string> }) | null => {
    if (!recentProgress?.length || !movies.length || !isRowMode) return null
    const movieIds = new Set(movies.map((m) => m.id))
    const watched = recentProgress.filter(
      (p) =>
        movieIds.has(p.channelId) &&
        (p.completed || (p.duration > 0 && p.position / p.duration > 0.5)),
    )
    if (!watched.length) return null
    const source = movies.find((m) => m.id === watched[0].channelId)
    if (!source) return null
    return { channel: source, key: source.id, kind: 'movie', watchedIds: new Set(watched.map((p) => p.channelId)) }
  }, [recentProgress, movies, isRowMode])

  // Enrich first N movies in row mode (covers all rows + gives TMDB genre data).
  // In the grid, enrich what is on screen plus the next rows: a fixed first-N window
  // meant nothing past it ever got artwork, however far one scrolled.
  const enrichTargets = useMemo(() => {
    if (isRowMode) {
      const seen = new Set<string>()
      const result: Channel[] = []
      for (const { channel } of continueWatchingMovies) {
        if (!seen.has(channel.id)) { seen.add(channel.id); result.push(channel) }
      }
      // The film "Since you watched" is about: its TMDB id is what the row asks with.
      if (recSource && !seen.has(recSource.key)) { seen.add(recSource.key); result.push(recSource.channel) }
      for (const m of movies) {
        if (result.length >= ENRICH_LIMIT) break
        if (!seen.has(m.id)) { seen.add(m.id); result.push(m) }
      }
      return result
    }
    return filtered.slice(0, count + ENRICH_AHEAD)
  }, [isRowMode, continueWatchingMovies, recSource, movies, filtered, count])

  const tmdbMap = useTmdbEnrich(enrichTargets)

  const recommendations = useBecauseYouWatched(
    recSource,
    recSource ? tmdbMap.get(recSource.key) : undefined,
    (id) => Boolean(recSource?.watchedIds.has(id) || progressMap?.[id]?.completed),
  )

  // TMDB genre rows — built from enriched data, populates progressively
  const tmdbGenreRows = useMemo(() => {
    if (!isRowMode) return []
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
      .slice(0, 6)
      .map(([genre, items]) => ({ genre, items: items.slice(0, 20) }))
  }, [movies, tmdbMap, isRowMode])


  const watchLaterSet = useLiveQuery(async () => {
    if (!activeProfileId) return new Set<string>()
    const entries = await db.watchLater.where('profileId').equals(activeProfileId).toArray()
    return new Set(entries.map((e) => e.contentId))
  }, [activeProfileId])

  const toggleWatchLater = async (channelId: string, e?: MouseEvent) => {
    e?.stopPropagation()
    if (!activeProfileId) return
    if (watchLaterSet?.has(channelId)) {
      await removeFromWatchLater(activeProfileId, channelId)
      deleteRemoteWatchLater(activeProfileId, channelId)
    } else {
      const entry = await addToWatchLater(activeProfileId, channelId, 'movie')
      pushWatchLater(entry)
    }
  }

  const handleGroupSelect = (g: string | null) => {
    setSelectedGroup(g)
    setSearch('')
    setGenre(null)
  }
  const handleGenreSelect = (g: Genre | null) => {
    setGenre(g)
    setSelectedGroup(null)
  }

  const openMovie = useDetailStore((s) => s.openMovie)

  // What is popular this week and here, at the top of the browse view.
  const movieHero = useHeroItems('movie')

  const handleOpenDetail = useCallback(
    (m: Channel) => {
      openMovie(m, tmdbMap.get(m.id) ?? null)
    },
    [tmdbMap, openMovie],
  )

  const handleSurprise = useCallback(() => {
    const pool = isRowMode ? movies : filtered
    if (!pool.length) return
    const m = pool[Math.floor(Math.random() * pool.length)]
    openMovie(m, tmdbMap.get(m.id) ?? null)
  }, [isRowMode, movies, filtered, tmdbMap, openMovie])

  useEffect(() => {
    reset()
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [search, selectedGroup, reset])

  if (movies.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<Film size={40} />}
          title={t('movies.emptyTitle')}
          description={t('movies.emptyBody')}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col md:flex-row">
        {/* Sidebar — always visible */}
        <div className="md:sticky md:top-0 md:self-start md:h-screen md:overflow-y-auto md:scrollbar-hide md:border-r md:border-white/5 md:shrink-0 md:p-4 md:pt-6">
          <GroupSidebar
            groups={groups}
            selected={selectedGroup}
            onSelect={handleGroupSelect}
            cleanTitle={cleanGroup}
          />
        </div>

        <div className="flex-1 min-w-0">
          {isRowMode ? (
            // ── Netflix row mode ───────────────────────────────────────────────
            <div className="px-4 sm:px-6 pb-12">
              {movieHero.length > 0 && (
                <div className="-mx-4 sm:-mx-6">
                  <Hero
                    items={movieHero}
                    onPlay={(ch) => play(ch)}
                    onMoreInfo={(ch) => {
                      openMovie(ch, tmdbMap.get(ch.id) ?? movieHero.find((x) => x.channel.id === ch.id)?.tmdbMeta ?? null)
                    }}
                    onWatchLater={(ch) => { void toggleWatchLater(ch.id) }}
                    isWatchLater={(ch) => watchLaterSet?.has(ch.id) ?? false}
                  />
                </div>
              )}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-5 pb-6">
                <div>
                  <h1 className="text-2xl font-bold text-white">{t('movies.title')}</h1>
                  <p className="text-neutral-500 text-sm mt-0.5">
                    {t('movies.count', { count: movies.length })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSurprise}
                    title={t('movies.surpriseTitle')}
                    className="flex items-center justify-center gap-1.5 min-h-11 min-w-11 px-3.5 py-2.5 rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-500 text-xs font-medium transition-colors shrink-0"
                  >
                    <Shuffle size={13} />
                    <span className="hidden sm:inline">{t('common.surpriseMe')}</span>
                  </button>
                  <div className="w-full sm:w-52">
                    <SearchBar value={search} onChange={setSearch} placeholder={t('movies.searchPlaceholder')} />
                  </div>
                </div>
              </div>
              <div className="-mt-2 mb-6">
                <GenreChips genres={genres} selected={genre} onSelect={handleGenreSelect} />
              </div>

              <div className="space-y-10">
                {continueWatchingMovies.length > 0 && (
                  <section>
                    <SectionHeader title={t('common.continueWatching')} />
                    <ScrollableRow>
                      {continueWatchingMovies.map(({ channel, progress }) => (
                        <div key={channel.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                          <ContinueCard
                            channel={channel}
                            progress={progress}
                            tmdbMeta={tmdbMap.get(channel.id)}
                            onClick={() => handleOpenDetail(channel)}
                            onRemove={() => {
                              if (activeProfileId) {
                                clearProgress(activeProfileId, channel.id)
                                deleteRemoteProgress(activeProfileId, channel.id)
                              }
                            }}
                          />
                        </div>
                      ))}
                    </ScrollableRow>
                  </section>
                )}

                {recentlyAdded.length > 0 && (
                <section>
                  <SectionHeader title={t('common.recentlyAdded')} />
                  <ScrollableRow>
                    {recentlyAdded.map((m) => (
                      <div key={m.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                        <MovieCard
                          channel={m}
                          progress={progressMap?.[m.id]}
                          isWatchLater={watchLaterSet?.has(m.id)}
                          tmdbMeta={tmdbMap.get(m.id)}
                          onClick={() => handleOpenDetail(m)}
                          onWatchLater={(e) => toggleWatchLater(m.id, e)}
                        />
                      </div>
                    ))}
                  </ScrollableRow>
                </section>
                )}

                {/* TMDB genre rows */}
                {tmdbGenreRows.map(({ genre, items }) => (
                  <section key={genre}>
                    <SectionHeader title={genre} />
                    <ScrollableRow>
                      {items.map((m) => (
                        <div key={m.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                          <MovieCard
                            channel={m}
                            progress={progressMap?.[m.id]}
                            isWatchLater={watchLaterSet?.has(m.id)}
                            tmdbMeta={tmdbMap.get(m.id)}
                            onClick={() => handleOpenDetail(m)}
                            onWatchLater={(e) => toggleWatchLater(m.id, e)}
                          />
                        </div>
                      ))}
                    </ScrollableRow>
                  </section>
                ))}

                {/* M3U group rows */}
                {groupRows.map(({ rawTitle, title, items }) => (
                  <section key={rawTitle}>
                    <SectionHeader
                      title={title}
                      onSeeAll={() => handleGroupSelect(rawTitle)}
                    />
                    <ScrollableRow>
                      {items.map((m) => (
                        <div key={m.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                          <MovieCard
                            channel={m}
                            progress={progressMap?.[m.id]}
                            isWatchLater={watchLaterSet?.has(m.id)}
                            tmdbMeta={tmdbMap.get(m.id)}
                            onClick={() => handleOpenDetail(m)}
                            onWatchLater={(e) => toggleWatchLater(m.id, e)}
                          />
                        </div>
                      ))}
                    </ScrollableRow>
                  </section>
                ))}

                {recommendations && recommendations.items.length > 0 && (
                  <section>
                    <SectionHeader
                      title={t('movies.sinceYouWatched', {
                        title: recommendations.title,
                      })}
                    />
                    <ScrollableRow>
                      {recommendations.items.map(({ channel: m, meta }) => (
                        <div key={m.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                          <MovieCard
                            channel={m}
                            progress={progressMap?.[m.id]}
                            isWatchLater={watchLaterSet?.has(m.id)}
                            tmdbMeta={tmdbMap.get(m.id) ?? meta}
                            onClick={() => openMovie(m, tmdbMap.get(m.id) ?? meta)}
                            onWatchLater={(e) => toggleWatchLater(m.id, e)}
                          />
                        </div>
                      ))}
                    </ScrollableRow>
                  </section>
                )}
              </div>
            </div>
          ) : (
            // ── Grid mode (search / group filter) ──────────────────────────────
            <>
              <div className="px-4 sm:px-6 pt-5 pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
                <div className="flex items-center justify-between sm:justify-start gap-3">
                  <h1 className="text-xl font-bold text-white truncate">
                    {genre
                      ? genre.name
                      : search.trim()
                        ? t('common.resultsFor', { query: search })
                        : cleanGroup(selectedGroup ?? '')}
                  </h1>
                  <p className="text-neutral-500 text-caption shrink-0">
                    {t('movies.count', { count: filtered.length })}
                  </p>
                  <button
                    onClick={handleSurprise}
                    title={t('movies.surpriseTitle')}
                    className="flex items-center justify-center gap-1.5 min-h-11 min-w-11 px-3.5 py-2.5 rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-500 text-xs font-medium transition-colors shrink-0"
                  >
                    <Shuffle size={13} />
                    <span className="hidden sm:inline">{t('common.surpriseMe')}</span>
                  </button>
                </div>
                <div className="sm:w-52">
                  <SearchBar value={search} onChange={setSearch} placeholder={t('movies.searchPlaceholder')} />
                </div>
              </div>
              <div className="px-4 sm:px-6 pb-4 space-y-2">
                <GenreChips genres={genres} selected={genre} onSelect={handleGenreSelect} />
                {genre && <p className="text-caption text-neutral-500">{t('genre.hint')}</p>}
              </div>

              {genre && genreList.loading ? (
                <div className="flex justify-center py-24">
                  <div className="h-8 w-8 rounded-full border-2 border-accent-600 border-t-transparent animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex items-center justify-center py-24">
                  <EmptyState
                    icon={<Film size={36} />}
                    title={t('common.noResults')}
                    description={t('common.tryAnotherSearch')}
                  />
                </div>
              ) : (
                <>
                  <div className="px-4 sm:px-6 pb-12 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {filtered.slice(0, count).map((m) => (
                      <MovieCard
                        key={m.id}
                        channel={m}
                        progress={progressMap?.[m.id]}
                        isWatchLater={watchLaterSet?.has(m.id)}
                        tmdbMeta={tmdbMap.get(m.id)}
                        onClick={() => handleOpenDetail(m)}
                        onWatchLater={(e) => toggleWatchLater(m.id, e)}
                      />
                    ))}
                  </div>
                  <div ref={sentinelRef} className="h-1" />
                  {count < filtered.length && (
                    <p className="text-center text-xs text-neutral-600 pb-8">
                      {t('common.showingOf', {
                        shown: formatNumber(Math.min(count, filtered.length)),
                        total: formatNumber(filtered.length),
                      })}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { normalizeShowKey } from '@/lib/utils'
import { Play, Film, Tv, Radio, Settings, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useProfileStore } from '@/stores/profileStore'
import { useActiveExclusions } from '@/hooks/useActiveExclusions'
import { db, clearProgress, addToWatchLater, removeFromWatchLater } from '@/services/db'
import { deleteRemoteProgress, pushWatchLater, deleteRemoteWatchLater } from '@/services/sync'
import { MovieCard } from '@/components/movies/MovieCard'
import { Poster } from '@/ui'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { Hero } from '@/components/home/Hero'
import { MovieDetailModal } from '@/components/home/MovieDetailModal'
import type { Channel, WatchProgress, TmdbMeta } from '@/types'
import { formatTime } from '@/lib/time'
import { useTmdbEnrich } from '@/hooks/useTmdbEnrich'

function ContinueCard({ channel, progress, tmdbMeta, onClick, onRemove }: {
  channel: Channel; progress: WatchProgress; tmdbMeta?: TmdbMeta; onClick: () => void; onRemove: () => void
}) {
  const pct = progress.duration > 0 ? (progress.position / progress.duration) * 100 : 0
  const subtitle = channel.type === 'series'
    ? `S${String(channel.season).padStart(2, '0')}E${String(channel.episode).padStart(2, '0')}`
    : (tmdbMeta?.year ?? channel.year) ? String(tmdbMeta?.year ?? channel.year) : ''

  return (
    <div className="group relative flex-shrink-0 w-44">
      <button onClick={onClick} className="block w-full text-left">
        <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-surface-300 ring-1 ring-white/5 group-hover:ring-accent-600/50 transition-all group-hover:scale-[1.03] shadow-card group-hover:shadow-card-hover">
          <Poster src={channel.logo} alt={channel.name} type={channel.type} className="w-full h-full" tmdbPosterPath={tmdbMeta?.posterPath} blurhash={tmdbMeta?.blurhashPoster} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/30">
              <Play size={16} fill="white" className="text-white ml-0.5" />
            </div>
          </div>
          <div className="absolute bottom-2 right-2">
            <ProgressRing pct={pct} size={30} stroke={2.5} />
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
            <div className="h-full bg-accent-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="mt-2 px-0.5">
          <p className="text-body text-white font-medium line-clamp-1">
            {tmdbMeta?.title ?? (channel.type === 'movie' ? (channel.movieTitle ?? channel.name) : (channel.showName ?? channel.name))}
          </p>
          <p className="text-caption text-neutral-500 mt-0.5">
            {subtitle && `${subtitle} · `}{formatTime(progress.position)} watched
          </p>
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        aria-label="Remove from Continue Watching"
        className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/70 hover:bg-danger-600/90 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all ring-1 ring-white/20"
      >
        <X size={14} />
      </button>
    </div>
  )
}

function ScrollableRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: false })
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); mo.disconnect() }
  }, [update])

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <div className="group/row relative">
      <div ref={ref} className="flex gap-4 overflow-x-auto scrollbar-hide pb-2">{children}</div>
      {canLeft && (
        <button onClick={() => scrollBy(-1)} aria-label="Scroll left"
          className="absolute left-0 top-0 bottom-2 w-12 flex items-center justify-center bg-gradient-to-r from-surface-100/90 via-surface-100/50 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity z-10">
          <div className="w-9 h-9 rounded-full bg-surface-400/80 ring-1 ring-white/15 flex items-center justify-center hover:bg-accent-600/60 transition-colors">
            <ChevronLeft size={20} className="text-white" />
          </div>
        </button>
      )}
      {canRight && (
        <button onClick={() => scrollBy(1)} aria-label="Scroll right"
          className="absolute right-0 top-0 bottom-2 w-12 flex items-center justify-center bg-gradient-to-l from-surface-100/90 via-surface-100/50 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity z-10">
          <div className="w-9 h-9 rounded-full bg-surface-400/80 ring-1 ring-white/15 flex items-center justify-center hover:bg-accent-600/60 transition-colors">
            <ChevronRight size={20} className="text-white" />
          </div>
        </button>
      )}
    </div>
  )
}

function SectionHeader({ title, to }: { title: string; to?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-heading-lg text-white">{title}</h2>
      {to && (
        <Link to={to} className="flex items-center gap-0.5 text-caption text-neutral-500 hover:text-accent-400 transition-colors">
          See all <ChevronRight size={13} />
        </Link>
      )}
    </div>
  )
}

export function HomePage() {
  const navigate = useNavigate()
  const { channels, loaded, m3uUrl } = usePlaylistStore()
  const { play } = usePlayerStore()
  const { activeProfileId } = useProfileStore()

  const [detailChannel, setDetailChannel] = useState<Channel | null>(null)
  const [detailTmdb, setDetailTmdb] = useState<TmdbMeta | null>(null)

  const excluded = useActiveExclusions()
  const movies = useMemo(() => channels.filter((c) => c.type === 'movie' && !excluded.movie.has(c.groupTitle)), [channels, excluded.movie])
  const series = useMemo(() => channels.filter((c) => c.type === 'series' && !excluded.series.has(c.groupTitle)), [channels, excluded.series])
  const live   = useMemo(() => channels.filter((c) => c.type === 'live'   && !excluded.live.has(c.groupTitle)),  [channels, excluded.live])

  const recentProgress = useLiveQuery(async () => {
    if (!activeProfileId) return []
    const all = await db.watchProgress.where('profileId').equals(activeProfileId).toArray()
    return all.sort((a, b) => b.lastWatched - a.lastWatched).slice(0, 20)
  }, [activeProfileId])

  const progressMap = useLiveQuery(async () => {
    if (!activeProfileId) return {}
    const profileIds = channels.slice(0, 500).map((c) => `${activeProfileId}:${c.id}`)
    const rows = await db.watchProgress.where('id').anyOf(profileIds).toArray()
    return Object.fromEntries(rows.map((r) => [r.channelId, r]))
  }, [channels, activeProfileId])

  const continueWatching = useMemo(() => {
    if (!recentProgress || !channels.length) return []
    const chanById = new Map(channels.map((c) => [c.id, c]))
    return recentProgress
      .filter((p) => !p.completed && p.position > 10)
      .map((p) => ({ progress: p, channel: chanById.get(p.channelId) }))
      .filter((x): x is { progress: WatchProgress; channel: Channel } => x.channel !== undefined)
      .slice(0, 12)
  }, [recentProgress, channels])

  const watchLaterEntries = useLiveQuery(async () => {
    if (!activeProfileId) return []
    return db.watchLater.where('profileId').equals(activeProfileId).toArray()
  }, [activeProfileId])

  const watchLaterSet = useMemo(
    () => new Set(watchLaterEntries?.map((e) => e.contentId) ?? []),
    [watchLaterEntries]
  )

  const toggleWatchLater = async (contentId: string, kind: 'movie' | 'series', e: React.MouseEvent) => {
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

  const recentMovies = useMemo(() => movies.slice(0, 14), [movies])

  const recentShows = useMemo(() => {
    const seen = new Set<string>()
    const result: Channel[] = []
    for (const ch of series) {
      const key = ch.showName ?? ch.name
      if (!seen.has(key)) { seen.add(key); result.push(ch) }
      if (result.length >= 12) break
    }
    return result
  }, [series])

  // "Because you watched X" — unwatched items from the same group as the most-recently-finished content
  const recommendations = useMemo(() => {
    if (!recentProgress?.length || !channels.length) return null
    const chanById = new Map(channels.map(c => [c.id, c]))

    const watchedChannels = recentProgress
      .filter(p => p.completed || (p.duration > 0 && p.position / p.duration > 0.5))
      .map(p => chanById.get(p.channelId))
      .filter(Boolean) as Channel[]

    if (!watchedChannels.length) return null

    const source = watchedChannels[0]
    const sourceKey = source.type === 'series' && source.showName
      ? normalizeShowKey(source.showName) : source.id

    const watchedIds = new Set(watchedChannels.map(c => c.id))
    const watchedShowKeys = new Set(watchedChannels.map(c =>
      c.type === 'series' && c.showName ? normalizeShowKey(c.showName) : c.id
    ))

    const pool: Channel[] = []
    for (const m of movies) {
      if (!watchedIds.has(m.id)) pool.push(m)
    }
    const seenShows = new Set<string>()
    for (const ch of series) {
      const k = normalizeShowKey(ch.showName ?? ch.name)
      if (!seenShows.has(k) && !watchedShowKeys.has(k)) {
        seenShows.add(k)
        pool.push(ch)
      }
    }

    const sameGroup = pool.filter(c => c.groupTitle === source.groupTitle)
    const candidates = sameGroup.length >= 4 ? sameGroup : pool
    if (!candidates.length) return null

    const shuffled = [...candidates]
      .sort(() => Math.random() - 0.5)
      .slice(0, 16)

    const title = source.movieTitle ?? source.showName ?? source.name
    return { title, sourceKey, items: shuffled }
  }, [recentProgress, channels, movies, series])

  const enrichTargets = useMemo(
    () => [
      ...continueWatching.map((x) => x.channel),
      ...recentMovies,
      ...recentShows,
      ...(recommendations?.items ?? []),
    ],
    [continueWatching, recentMovies, recentShows, recommendations]
  )
  const tmdbMap = useTmdbEnrich(enrichTargets)

  // Hero items: movies + shows from recent lists that have backdrop data
  const heroItems = useMemo(() => {
    const candidates: Array<{ channel: Channel; tmdbMeta: TmdbMeta }> = []
    for (const ch of [...recentMovies, ...recentShows]) {
      const key = ch.type === 'series' && ch.showName ? normalizeShowKey(ch.showName) : ch.id
      const meta = tmdbMap.get(key)
      if (meta && !meta.notFound && meta.backdropPath) candidates.push({ channel: ch, tmdbMeta: meta })
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
          <h1 className="text-heading-xl text-white mb-2">Welcome to StreamForest</h1>
          <p className="text-neutral-400 text-body leading-relaxed">
            To get started, add your M3U playlist URL in Settings and download your channels.
          </p>
        </div>
        <Link to="/settings" className="flex items-center gap-2 px-5 py-2.5 bg-accent-600 hover:bg-accent-500 rounded-lg text-white text-body font-medium transition-colors">
          <Settings size={15} />
          Open Settings
        </Link>
      </div>
    )
  }

  return (
    <>
      {/* Cinematic hero — full-bleed, outside padded container */}
      {heroItems.length > 0 && (
        <Hero
          items={heroItems}
          onPlay={(ch) => {
            if (ch.type === 'movie') navigate(`/movies?playing=${ch.id}`)
            else if (ch.type === 'series') navigate(`/series?show=${encodeURIComponent(normalizeShowKey(ch.showName ?? ch.name))}`)
            play(ch)
          }}
          onMoreInfo={(ch) => {
            const key = ch.type === 'series' && ch.showName ? normalizeShowKey(ch.showName) : ch.id
            setDetailChannel(ch)
            setDetailTmdb(tmdbMap.get(key) ?? null)
          }}
          onWatchLater={(ch) => {
            if (!activeProfileId) return
            const id = ch.type === 'series' && ch.showName ? normalizeShowKey(ch.showName) : ch.id
            const kind: 'movie' | 'series' = ch.type === 'series' ? 'series' : 'movie'
            if (watchLaterSet.has(id)) {
              removeFromWatchLater(activeProfileId, id)
              deleteRemoteWatchLater(activeProfileId, id)
            } else {
              addToWatchLater(activeProfileId, id, kind).then(pushWatchLater)
            }
          }}
          isWatchLater={(ch) => {
            const id = ch.type === 'series' && ch.showName ? normalizeShowKey(ch.showName) : ch.id
            return watchLaterSet.has(id)
          }}
        />
      )}

      {/* Scrollable content */}
      <div className="px-4 sm:px-6 pb-12 pt-6">
        {/* Stats bar */}
        <div className="flex gap-2 sm:gap-3 mb-6 sm:mb-8">
          {[
            { icon: Film,  label: 'Movies',        count: movies.length, to: '/movies' },
            { icon: Tv,    label: 'TV Shows',       count: new Set(series.filter((s) => s.showName).map((s) => s.showName)).size, to: '/series' },
            { icon: Radio, label: 'Live Channels',  count: live.length,  to: '/live'   },
          ].map(({ icon: Icon, label, count, to }) => (
            <Link key={to} to={to}
              className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-3 rounded-xl bg-white/3 hover:bg-white/6 ring-1 ring-white/5 hover:ring-accent-600/30 transition-all flex-1 min-w-0"
            >
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-accent-600/20 flex items-center justify-center shrink-0">
                <Icon size={15} className="text-accent-400" />
              </div>
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm">{count.toLocaleString()}</p>
                <p className="text-neutral-500 text-[10px] sm:text-caption truncate">{label}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Continue Watching */}
        {continueWatching.length > 0 && (
          <section className="mb-10">
            <SectionHeader title="Continue Watching" />
            <ScrollableRow>
              {continueWatching.map(({ channel, progress }) => {
                const tmdbKey = channel.type === 'series' && channel.showName
                  ? normalizeShowKey(channel.showName) : channel.id
                return (
                  <ContinueCard
                    key={channel.id}
                    channel={channel}
                    progress={progress}
                    tmdbMeta={tmdbMap.get(tmdbKey)}
                    onClick={() => {
                      if (channel.type === 'movie') navigate(`/movies?playing=${channel.id}`)
                      else if (channel.type === 'series') navigate(`/series?show=${encodeURIComponent(normalizeShowKey(channel.showName ?? channel.name))}&playing=${channel.id}`)
                      play(channel)
                    }}
                    onRemove={() => {
                      if (activeProfileId) {
                        clearProgress(activeProfileId, channel.id)
                        deleteRemoteProgress(activeProfileId, channel.id)
                      }
                    }}
                  />
                )
              })}
            </ScrollableRow>
          </section>
        )}

        {/* Recent Movies */}
        {recentMovies.length > 0 && (
          <section className="mb-10">
            <SectionHeader title="Recently Added Movies" to="/movies" />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
              {recentMovies.map((m) => (
                <MovieCard key={m.id} channel={m} progress={progressMap?.[m.id]}
                  isWatchLater={watchLaterSet.has(m.id)}
                  tmdbMeta={tmdbMap.get(m.id)}
                  onClick={() => { navigate(`/movies?playing=${m.id}`); play(m) }}
                  onWatchLater={(e) => toggleWatchLater(m.id, 'movie', e)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Recent TV Shows */}
        {recentShows.length > 0 && (
          <section className="mb-10">
            <SectionHeader title="Recently Added TV Shows" to="/series" />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
              {recentShows.map((ch) => {
                const showKey = normalizeShowKey(ch.showName ?? ch.name)
                const episodeLabel = ch.season != null && ch.episode != null
                  ? `S${String(ch.season).padStart(2, '0')}E${String(ch.episode).padStart(2, '0')}${ch.episodeTitle ? ` · ${ch.episodeTitle}` : ''}`
                  : undefined
                return (
                  <MovieCard key={ch.id} channel={ch} progress={progressMap?.[ch.id]}
                    isWatchLater={watchLaterSet.has(showKey)}
                    tmdbMeta={tmdbMap.get(showKey)}
                    episodeLabel={episodeLabel}
                    onClick={() => { navigate(`/series?show=${encodeURIComponent(showKey)}&playing=${ch.id}`); play(ch) }}
                    onWatchLater={(e) => toggleWatchLater(showKey, 'series', e)}
                  />
                )
              })}
            </div>
          </section>
        )}

        {/* Because you watched X */}
        {recommendations && recommendations.items.length > 0 && (
          <section className="mb-10">
            <SectionHeader
              title={`Because you watched ${tmdbMap.get(recommendations.sourceKey)?.title ?? recommendations.title}`}
            />
            <ScrollableRow>
              {recommendations.items.map((ch) => {
                const key = ch.type === 'series' && ch.showName ? normalizeShowKey(ch.showName) : ch.id
                return (
                  <div key={ch.id} className="flex-shrink-0 w-36">
                    <MovieCard
                      channel={ch}
                      tmdbMeta={tmdbMap.get(key)}
                      isWatchLater={watchLaterSet.has(key)}
                      onClick={() => {
                        if (ch.type === 'series' && ch.showName) {
                          navigate(`/series?show=${encodeURIComponent(normalizeShowKey(ch.showName))}`)
                        } else {
                          navigate(`/movies?playing=${ch.id}`)
                          play(ch)
                        }
                      }}
                      onWatchLater={(e) => toggleWatchLater(key, ch.type === 'series' ? 'series' : 'movie', e)}
                    />
                  </div>
                )
              })}
            </ScrollableRow>
          </section>
        )}
      </div>

      {/* Movie / Show detail modal */}
      <MovieDetailModal
        channel={detailChannel}
        tmdbMeta={detailTmdb}
        isWatchLater={detailChannel ? watchLaterSet.has(
          detailChannel.type === 'series' && detailChannel.showName
            ? normalizeShowKey(detailChannel.showName)
            : detailChannel.id
        ) : false}
        onClose={() => { setDetailChannel(null); setDetailTmdb(null) }}
        onPlay={() => {
          if (!detailChannel) return
          if (detailChannel.type === 'movie') navigate(`/movies?playing=${detailChannel.id}`)
          else navigate(`/series?show=${encodeURIComponent(normalizeShowKey(detailChannel.showName ?? detailChannel.name))}`)
          play(detailChannel)
          setDetailChannel(null)
          setDetailTmdb(null)
        }}
        onWatchLater={() => {
          if (!detailChannel || !activeProfileId) return
          const id = detailChannel.type === 'series' && detailChannel.showName
            ? normalizeShowKey(detailChannel.showName) : detailChannel.id
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

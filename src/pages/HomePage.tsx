import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { normalizeShowKey } from '@/lib/utils'
import { Play, Film, Tv, Radio, Settings, ChevronLeft, ChevronRight, X, Bookmark } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useProfileStore } from '@/stores/profileStore'
import { useActiveExclusions } from '@/hooks/useActiveExclusions'
import { db, clearProgress, addToWatchLater, removeFromWatchLater } from '@/services/db'
import { deleteRemoteProgress, pushWatchLater, deleteRemoteWatchLater } from '@/services/sync'
import { MovieCard } from '@/components/movies/MovieCard'
import { Poster } from '@/components/ui/Poster'
import { ProgressRing } from '@/components/ui/ProgressRing'
import type { Channel, WatchProgress, WatchLater } from '@/types'
import { formatTime } from '@/lib/time'

function ContinueCard({ channel, progress, onClick, onRemove }: { channel: Channel; progress: WatchProgress; onClick: () => void; onRemove: () => void }) {
  const pct = progress.duration > 0 ? (progress.position / progress.duration) * 100 : 0
  const subtitle = channel.type === 'series'
    ? `S${String(channel.season).padStart(2, '0')}E${String(channel.episode).padStart(2, '0')}`
    : channel.year ? String(channel.year) : ''

  return (
    <div className="group relative flex-shrink-0 w-44 animate-fade-in">
      <button onClick={onClick} className="block w-full text-left">
        <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-[#1a1a1a] ring-1 ring-white/5 group-hover:ring-accent-600/50 transition-all group-hover:scale-[1.03] group-hover:shadow-xl group-hover:shadow-black/60">
          <Poster src={channel.logo} alt={channel.name} type={channel.type} className="w-full h-full" />
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
          <p className="text-sm text-white font-medium line-clamp-1">
            {channel.type === 'movie' ? (channel.movieTitle ?? channel.name) : (channel.showName ?? channel.name)}
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {subtitle && `${subtitle} · `}{formatTime(progress.position)} watched
          </p>
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        aria-label="Remove from Continue Watching"
        title="Remove from Continue Watching"
        className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/70 hover:bg-red-600/90 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all ring-1 ring-white/20"
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
    // Children also affect scrollWidth — observe each child too via mutation
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: false })
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
      mo.disconnect()
    }
  }, [update])

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <div className="group/row relative">
      <div ref={ref} className="flex gap-4 overflow-x-auto scrollbar-hide pb-2">
        {children}
      </div>
      {canLeft && (
        <button
          onClick={() => scrollBy(-1)}
          aria-label="Scroll left"
          className="absolute left-0 top-0 bottom-2 w-12 flex items-center justify-center bg-gradient-to-r from-black/80 via-black/50 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity z-10"
        >
          <div className="w-9 h-9 rounded-full bg-black/70 ring-1 ring-white/20 flex items-center justify-center hover:bg-accent-600/80 transition-colors">
            <ChevronLeft size={20} className="text-white" />
          </div>
        </button>
      )}
      {canRight && (
        <button
          onClick={() => scrollBy(1)}
          aria-label="Scroll right"
          className="absolute right-0 top-0 bottom-2 w-12 flex items-center justify-center bg-gradient-to-l from-black/80 via-black/50 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity z-10"
        >
          <div className="w-9 h-9 rounded-full bg-black/70 ring-1 ring-white/20 flex items-center justify-center hover:bg-accent-600/80 transition-colors">
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
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {to && (
        <Link to={to} className="flex items-center gap-0.5 text-xs text-neutral-500 hover:text-accent-400 transition-colors">
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

  const excluded = useActiveExclusions()
  const movies = useMemo(() => channels.filter((c) => c.type === 'movie' && !excluded.movie.has(c.groupTitle)), [channels, excluded.movie])
  const series = useMemo(() => channels.filter((c) => c.type === 'series' && !excluded.series.has(c.groupTitle)), [channels, excluded.series])
  const live = useMemo(() => channels.filter((c) => c.type === 'live' && !excluded.live.has(c.groupTitle)), [channels, excluded.live])

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
      .then((rows) => rows.sort((a, b) => b.addedAt - a.addedAt))
  }, [activeProfileId])

  const watchLaterSet = useMemo(
    () => new Set(watchLaterEntries?.map((e) => e.contentId) ?? []),
    [watchLaterEntries]
  )

  const watchLaterResolved = useMemo(() => {
    if (!watchLaterEntries || !channels.length) return []
    const chanById = new Map(channels.map((c) => [c.id, c]))
    // Build a map of normalizedShowKey -> representative channel for series
    const showRepMap = new Map<string, Channel>()
    for (const ch of channels) {
      if (ch.type === 'series' && ch.showName) {
        const key = normalizeShowKey(ch.showName)
        if (!showRepMap.has(key)) showRepMap.set(key, ch)
      }
    }
    return watchLaterEntries
      .map((entry): { entry: WatchLater; channel: Channel } | null => {
        if (entry.kind === 'movie') {
          const ch = chanById.get(entry.contentId)
          return ch ? { entry, channel: ch } : null
        } else {
          const ch = showRepMap.get(entry.contentId)
          return ch ? { entry, channel: ch } : null
        }
      })
      .filter((x): x is { entry: WatchLater; channel: Channel } => x !== null)
      .slice(0, 12)
  }, [watchLaterEntries, channels])

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

  // Distinct shows from recent series entries (preserve M3U order)
  const recentShows = useMemo(() => {
    const seen = new Set<string>()
    const result: Channel[] = []
    for (const ch of series) {
      const key = ch.showName ?? ch.name
      if (!seen.has(key)) {
        seen.add(key)
        result.push(ch)
        if (result.length >= 12) break
      }
    }
    return result
  }, [series])

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
          <h1 className="text-2xl font-bold text-white mb-2">Welcome to StreamForest</h1>
          <p className="text-neutral-400 text-sm leading-relaxed">
            To get started, add your M3U playlist URL in Settings and download your channels.
          </p>
        </div>
        <Link
          to="/settings"
          className="flex items-center gap-2 px-5 py-2.5 bg-accent-600 hover:bg-accent-500 rounded-lg text-white text-sm font-medium transition-colors"
        >
          <Settings size={15} />
          Open Settings
        </Link>
      </div>
    )
  }

  return (
    <div className="p-6 pb-12">
      {/* Stats bar */}
      <div className="flex gap-4 mb-8">
        {[
          { icon: Film, label: 'Movies', count: movies.length, to: '/movies' },
          { icon: Tv, label: 'TV Shows', count: new Set(series.filter((s) => s.showName).map((s) => s.showName)).size, to: '/series' },
          { icon: Radio, label: 'Live Channels', count: live.length, to: '/live' },
        ].map(({ icon: Icon, label, count, to }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/3 hover:bg-white/6 ring-1 ring-white/5 hover:ring-accent-600/30 transition-all flex-1"
          >
            <div className="w-8 h-8 rounded-lg bg-accent-600/20 flex items-center justify-center shrink-0">
              <Icon size={16} className="text-accent-400" />
            </div>
            <div>
              <p className="text-white font-semibold text-sm">{count.toLocaleString()}</p>
              <p className="text-neutral-500 text-xs">{label}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Watch Later */}
      {watchLaterResolved.length > 0 && (
        <section className="mb-10">
          <SectionHeader title="Watch Later" />
          <ScrollableRow>
            {watchLaterResolved.map(({ entry, channel }) => {
              const showKey = entry.kind === 'series' ? normalizeShowKey(channel.showName ?? channel.name) : null
              return (
                <div key={entry.id} className="group relative flex-shrink-0 w-44 animate-fade-in">
                  <button
                    onClick={() => {
                      if (entry.kind === 'movie') { navigate(`/movies?playing=${channel.id}`); play(channel) }
                      else navigate(`/series?show=${encodeURIComponent(showKey!)}`)
                    }}
                    className="block w-full text-left"
                  >
                    <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-[#1a1a1a] ring-1 ring-white/5 group-hover:ring-accent-600/50 transition-all group-hover:scale-[1.03] group-hover:shadow-xl group-hover:shadow-black/60">
                      <Poster src={channel.logo} alt={channel.name} type={channel.type} className="w-full h-full" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/30">
                          <Play size={16} fill="white" className="text-white ml-0.5" />
                        </div>
                      </div>
                      <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-accent-600/80 flex items-center justify-center">
                        <Bookmark size={11} fill="white" className="text-white" />
                      </div>
                    </div>
                    <div className="mt-2 px-0.5">
                      <p className="text-sm text-white font-medium line-clamp-1">
                        {entry.kind === 'movie' ? (channel.movieTitle ?? channel.name) : (channel.showName ?? channel.name)}
                      </p>
                      <p className="text-xs text-neutral-500 mt-0.5 capitalize">{entry.kind}</p>
                    </div>
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (!activeProfileId) return
                      await removeFromWatchLater(activeProfileId, entry.contentId)
                      deleteRemoteWatchLater(activeProfileId, entry.contentId)
                    }}
                    aria-label="Remove from Watch Later"
                    className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/70 hover:bg-red-600/90 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all ring-1 ring-white/20"
                  >
                    <X size={14} />
                  </button>
                </div>
              )
            })}
          </ScrollableRow>
        </section>
      )}

      {/* Continue Watching */}
      {continueWatching.length > 0 && (
        <section className="mb-10">
          <SectionHeader title="Continue Watching" />
          <ScrollableRow>
            {continueWatching.map(({ channel, progress }) => (
              <ContinueCard
                key={channel.id}
                channel={channel}
                progress={progress}
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
            ))}
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
              return (
                <MovieCard key={ch.id} channel={ch} progress={progressMap?.[ch.id]}
                  isWatchLater={watchLaterSet.has(showKey)}
                  onClick={() => { navigate(`/series?show=${encodeURIComponent(showKey)}&playing=${ch.id}`); play(ch) }}
                  onWatchLater={(e) => toggleWatchLater(showKey, 'series', e)}
                />
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

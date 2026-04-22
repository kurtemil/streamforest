import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { Play, Film, Tv, Radio, Settings, ChevronRight } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { db } from '@/services/db'
import { MovieCard } from '@/components/movies/MovieCard'
import { Poster } from '@/components/ui/Poster'
import { ProgressRing } from '@/components/ui/ProgressRing'
import type { Channel, WatchProgress } from '@/types'
import { formatTime } from '@/lib/time'

function ContinueCard({ channel, progress, onClick }: { channel: Channel; progress: WatchProgress; onClick: () => void }) {
  const pct = progress.duration > 0 ? (progress.position / progress.duration) * 100 : 0
  const subtitle = channel.type === 'series'
    ? `S${String(channel.season).padStart(2, '0')}E${String(channel.episode).padStart(2, '0')}`
    : channel.year ? String(channel.year) : ''

  return (
    <button onClick={onClick} className="group flex-shrink-0 w-44 text-left animate-fade-in">
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
          {subtitle && `${subtitle} · `}{formatTime(progress.position)} left
        </p>
      </div>
    </button>
  )
}

function SectionHeader({ title, to }: { title: string; to: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <Link to={to} className="flex items-center gap-0.5 text-xs text-neutral-500 hover:text-accent-400 transition-colors">
        See all <ChevronRight size={13} />
      </Link>
    </div>
  )
}

export function HomePage() {
  const { channels, loaded, m3uUrl } = usePlaylistStore()
  const { play } = usePlayerStore()

  const movies = useMemo(() => channels.filter((c) => c.type === 'movie'), [channels])
  const series = useMemo(() => channels.filter((c) => c.type === 'series'), [channels])
  const live = useMemo(() => channels.filter((c) => c.type === 'live'), [channels])

  const recentProgress = useLiveQuery(() =>
    db.watchProgress
      .orderBy('lastWatched')
      .reverse()
      .limit(20)
      .toArray()
  )

  const progressMap = useLiveQuery(async () => {
    const ids = channels.slice(0, 500).map((c) => c.id)
    const rows = await db.watchProgress.where('id').anyOf(ids).toArray()
    return Object.fromEntries(rows.map((r) => [r.id, r]))
  }, [channels])

  const continueWatching = useMemo(() => {
    if (!recentProgress || !channels.length) return []
    const chanById = new Map(channels.map((c) => [c.id, c]))
    return recentProgress
      .filter((p) => !p.completed && p.position > 10)
      .map((p) => ({ progress: p, channel: chanById.get(p.id) }))
      .filter((x): x is { progress: WatchProgress; channel: Channel } => x.channel !== undefined)
      .slice(0, 12)
  }, [recentProgress, channels])

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

      {/* Continue Watching */}
      {continueWatching.length > 0 && (
        <section className="mb-10">
          <SectionHeader title="Continue Watching" to="/" />
          <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2">
            {continueWatching.map(({ channel, progress }) => (
              <ContinueCard
                key={channel.id}
                channel={channel}
                progress={progress}
                onClick={() => play(channel)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Recent Movies */}
      {recentMovies.length > 0 && (
        <section className="mb-10">
          <SectionHeader title="Recently Added Movies" to="/movies" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
            {recentMovies.map((m) => (
              <MovieCard key={m.id} channel={m} progress={progressMap?.[m.id]} onClick={() => play(m)} />
            ))}
          </div>
        </section>
      )}

      {/* Recent TV Shows */}
      {recentShows.length > 0 && (
        <section className="mb-10">
          <SectionHeader title="Recently Added TV Shows" to="/series" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
            {recentShows.map((ch) => (
              <MovieCard key={ch.id} channel={ch} progress={progressMap?.[ch.id]} onClick={() => play(ch)} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

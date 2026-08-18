import { Play, X } from 'lucide-react'
import { Poster } from '@/ui'
import { formatTime } from '@/lib/time'
import { progressPercent } from '@/lib/progress'
import type { Channel, WatchProgress, TmdbMeta } from '@/types'

/* Card decorations carry no backdrop-filter, and that is deliberate. Measured on
   a phone-shaped viewport: 49 blurred layers on Home, 23 of them on screen at
   once, 47 of the 49 being this 28px chip repeated once per card — and scrolling
   held p50 35-43ms a frame, under 30fps, before any artwork had even loaded.
   Each one makes the compositor resample and blur the poster behind it every
   frame the row moves. At 28px over dense artwork the blur was not visible
   anyway; the translucent fill alone reads identically. Blur is kept where it is
   one large surface doing the work of glass: the tab bar, dialogs, the player.
   `e2e/perf-probe.spec.ts` is the measurement, if it needs repeating. */
export function ContinueCard({
  channel,
  progress,
  tmdbMeta,
  onClick,
  onRemove,
}: {
  channel: Channel
  progress: WatchProgress
  tmdbMeta?: TmdbMeta
  onClick: () => void
  onRemove: () => void
}) {
  const pct = progressPercent(progress.position, progress.duration)
  const subtitle =
    channel.type === 'series'
      ? `S${String(channel.season).padStart(2, '0')}E${String(channel.episode).padStart(2, '0')}`
      : (tmdbMeta?.year ?? channel.year)
      ? String(tmdbMeta?.year ?? channel.year)
      : ''

  return (
    <div className="group relative w-full">
      <button onClick={onClick} className="block w-full text-left press">
        <div className="relative w-full aspect-[2/3] rounded-card overflow-hidden bg-surface-300 ring-1 ring-white/8 transition-all duration-300 ease-out-expo group-hover:scale-[1.04] group-hover:-translate-y-1 shadow-card group-hover:shadow-card-hover">
          <Poster
            src={channel.logo}
            alt={channel.name}
            type={channel.type}
            className="w-full h-full"
            tmdbPosterPath={tmdbMeta?.posterPath}
            blurhash={tmdbMeta?.blurhashPoster}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <div className="absolute inset-0 hidden md:flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center ring-2 ring-white/30">
              <Play size={16} fill="white" className="text-white ml-0.5" />
            </div>
          </div>
          {/* One indicator. A ring and a bar in the same corner said the same
              thing twice and made a poster look instrumented. */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
            <div className="h-full bg-accent-500 rounded-r-full" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="mt-2 px-0.5">
          <p className="text-body text-white font-medium line-clamp-1">
            {tmdbMeta?.title ??
              (channel.type === 'movie'
                ? (channel.movieTitle ?? channel.name)
                : (channel.showName ?? channel.name))}
          </p>
          <p className="text-caption text-neutral-500 mt-0.5">
            {subtitle && `${subtitle} · `}
            {formatTime(progress.position)} watched
          </p>
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label="Remove from Continue Watching"
        className="absolute top-2 left-2 w-7 h-7 rounded-full after:absolute after:content-[''] after:-inset-2 bg-black/70 hover:bg-danger-600/90 flex items-center justify-center text-white opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-all ring-1 ring-white/20"
      >
        <X size={14} />
      </button>
    </div>
  )
}

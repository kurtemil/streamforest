import { Play, Check, Bookmark, Star, X } from 'lucide-react'
import { Poster } from '@/ui'
import { progressPercent } from '@/lib/progress'
import type { Channel, WatchProgress, TmdbMeta } from '@/types'

interface Props {
  channel: Channel
  progress?: WatchProgress
  isWatchLater?: boolean
  tmdbMeta?: TmdbMeta
  episodeLabel?: string
  onClick: () => void
  onWatchLater?: (e: React.MouseEvent) => void
  onRemove?: (e: React.MouseEvent) => void
}

export function MovieCard({ channel, progress, isWatchLater, tmdbMeta, episodeLabel, onClick, onWatchLater, onRemove }: Props) {
  const pct = progress ? Math.round(progressPercent(progress.position, progress.duration)) : 0

  const displayTitle = tmdbMeta?.title ?? channel.movieTitle ?? channel.showName ?? channel.name
  const displayYear  = tmdbMeta?.year  ?? channel.year
  const rating       = tmdbMeta && !tmdbMeta.notFound && tmdbMeta.rating > 0 ? tmdbMeta.rating : null

  return (
    <button onClick={onClick} className="group text-left w-full">
      <div className="relative aspect-[2/3] rounded-card overflow-hidden bg-surface-300 ring-1 ring-white/8 transition-all duration-300 ease-out-expo group-hover:scale-[1.04] group-hover:-translate-y-1 shadow-card group-hover:shadow-card-hover">
        <Poster
          src={channel.logo}
          alt={displayTitle}
          type={channel.type}
          className="w-full h-full"
          tmdbPosterPath={tmdbMeta?.posterPath}
          blurhash={tmdbMeta?.blurhashPoster}
        />

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="absolute inset-0 hidden md:flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/30">
            <Play size={18} fill="white" className="text-white ml-0.5" />
          </div>
        </div>

        {/* Remove button (e.g. Continue Watching) */}
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(e) }}
            aria-label="Remove"
            className="absolute top-2 left-2 w-7 h-7 rounded-full after:absolute after:content-[''] after:-inset-2 bg-black/70 hover:bg-red-600/90 backdrop-blur-sm flex items-center justify-center text-white opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-all ring-1 ring-white/20 z-10"
          >
            <X size={13} />
          </button>
        )}

        {/* Watch Later toggle */}
        {onWatchLater && (
          <button
            onClick={onWatchLater}
            title={isWatchLater ? 'Remove from Watch Later' : 'Add to Watch Later'}
            className={`absolute top-2 left-2 w-7 h-7 rounded-full after:absolute after:content-[''] after:-inset-2 backdrop-blur-sm flex items-center justify-center ring-1 transition-all z-10 ${
              isWatchLater
                ? 'bg-accent-600/90 ring-accent-500/60 opacity-100'
                : 'bg-black/70 ring-white/20 opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100 hover:bg-accent-600/80'
            }`}
          >
            <Bookmark size={13} fill={isWatchLater ? 'white' : 'none'} className="text-white" />
          </button>
        )}

        {/* Rating chip */}
        {rating !== null && (
          <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-black/70 backdrop-blur-sm rounded-full px-1.5 py-0.5 ring-1 ring-white/15">
            <Star size={9} fill="#f59e0b" className="text-warn-500 shrink-0" />
            <span className="text-micro font-semibold text-white">{rating.toFixed(1)}</span>
          </div>
        )}

        {/* Completed badge */}
        {progress?.completed && !rating && (
          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-accent-600 flex items-center justify-center">
            <Check size={12} className="text-white" />
          </div>
        )}

        {/* Progress bar + ring */}
        {!progress?.completed && pct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
            <div className="h-full bg-accent-400 rounded-r-full" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="mt-2 px-0.5 min-h-[3.75rem]">
        <p className="text-body text-white font-medium leading-tight line-clamp-2">{displayTitle}</p>
        <div className="flex items-center gap-1.5 mt-0.5 h-[1.1rem]">
          {episodeLabel && <span className="text-caption text-accent-400 font-medium shrink-0 truncate">{episodeLabel}</span>}
          {!episodeLabel && displayYear && <span className="text-caption text-neutral-500 shrink-0">{displayYear}</span>}
          {!episodeLabel && tmdbMeta?.genres?.[0] && (
            <span className="text-caption text-neutral-600 truncate">{tmdbMeta.genres[0]}</span>
          )}
        </div>
      </div>
    </button>
  )
}

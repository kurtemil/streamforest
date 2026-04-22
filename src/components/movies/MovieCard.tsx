import { Play, Check } from 'lucide-react'
import { Poster } from '@/components/ui/Poster'
import { ProgressRing } from '@/components/ui/ProgressRing'
import type { Channel, WatchProgress } from '@/types'

interface Props {
  channel: Channel
  progress?: WatchProgress
  onClick: () => void
}

export function MovieCard({ channel, progress, onClick }: Props) {
  const pct = progress && progress.duration > 0
    ? Math.round((progress.position / progress.duration) * 100)
    : 0

  return (
    <button
      onClick={onClick}
      className="group text-left animate-fade-in"
    >
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[#1a1a1a] ring-1 ring-white/5 group-hover:ring-accent-600/50 transition-all duration-200 group-hover:scale-[1.02] group-hover:shadow-xl group-hover:shadow-black/60">
        <Poster src={channel.logo} alt={channel.name} type="movie" className="w-full h-full" />

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        {/* Play button */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/30">
            <Play size={18} fill="white" className="text-white ml-0.5" />
          </div>
        </div>

        {/* Completed badge */}
        {progress?.completed && (
          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-accent-600 flex items-center justify-center">
            <Check size={12} className="text-white" />
          </div>
        )}

        {/* Progress ring */}
        {!progress?.completed && pct > 0 && (
          <div className="absolute bottom-2 right-2">
            <ProgressRing pct={pct} size={30} stroke={2.5} />
          </div>
        )}

        {/* Progress bar */}
        {!progress?.completed && pct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
            <div className="h-full bg-accent-500" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="mt-2 px-0.5">
        <p className="text-sm text-white font-medium leading-tight line-clamp-2">
          {channel.movieTitle ?? channel.name}
        </p>
        {channel.year && (
          <p className="text-xs text-neutral-500 mt-0.5">{channel.year}</p>
        )}
      </div>
    </button>
  )
}

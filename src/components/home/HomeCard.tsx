import { Film, Play } from 'lucide-react'
import { posterUrl, type HomeItem } from '@/services/jellyfin'
import { WatchedMarks } from '@/components/ui/WatchedMarks'

/** A poster card for a title in the home library, with its progress bar. */
export function HomeCard({ item, onClick }: { item: HomeItem; onClick: () => void }) {
  const src = posterUrl(item)
  const pct = !item.played && item.durationSec > 0 && item.positionSec > 10
    ? Math.min(100, Math.round((item.positionSec / item.durationSec) * 100))
    : 0
  return (
    <button onClick={onClick} className="group press text-left w-full">
      <div className="relative aspect-[2/3] rounded-card overflow-hidden bg-surface-300 ring-1 ring-white/8 transition-all duration-300 ease-out-expo group-hover:scale-[1.04] group-hover:-translate-y-1 shadow-card group-hover:shadow-card-hover">
        {src ? (
          <img src={src} alt={item.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-600">
            <Film size={28} />
          </div>
        )}
        <div className="absolute inset-0 hidden md:flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <div className="w-11 h-11 rounded-full bg-black/60 flex items-center justify-center ring-2 ring-white/30">
            <Play size={18} fill="white" className="text-white ml-0.5" />
          </div>
        </div>
        <WatchedMarks watched={item.played} pct={pct} />
      </div>
      <div className="mt-2 px-0.5 min-h-[3.75rem]">
        <p className="text-body text-white font-medium leading-tight line-clamp-2">{item.name}</p>
        {item.year && <p className="text-caption text-neutral-500 mt-0.5">{item.year}</p>}
      </div>
    </button>
  )
}

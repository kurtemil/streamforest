import { Check } from 'lucide-react'
import { useT } from '@/lib/i18n'

/**
 * The marks a poster carries for what this profile has seen: a check when it is
 * finished, a bar when it is under way. Bottom right, because the top corners
 * belong to watch later and the rating, and the rating used to hide the check:
 * it was only drawn on cards without one, which on a library with TMDB artwork
 * meant almost never.
 */
export function WatchedMarks({ watched, pct, label }: { watched: boolean; pct: number; label?: string }) {
  const t = useT()
  if (watched) {
    return (
      <div
        role="img"
        aria-label={label ?? t('card.watchedBadge')}
        title={label ?? t('card.watchedBadge')}
        className="absolute bottom-2 right-2 w-6 h-6 rounded-full bg-accent-600 ring-2 ring-black/40 flex items-center justify-center"
      >
        <Check size={13} strokeWidth={3} className="text-white" />
      </div>
    )
  }
  if (pct <= 0) return null
  return (
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50" title={label}>
      <div className="h-full bg-accent-400 rounded-r-full" style={{ width: `${Math.min(100, pct)}%` }} />
      {label && <span className="sr-only">{label}</span>}
    </div>
  )
}

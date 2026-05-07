import { useState } from 'react'
import { Film, Tv, Radio } from 'lucide-react'
import type { ContentType } from '@/types'
import { posterUrl } from '@/services/tmdb'

interface Props {
  /** M3U tvg-logo URL — used as fallback if TMDB poster unavailable. */
  src: string
  alt: string
  type: ContentType
  className?: string
  /** TMDB poster_path (e.g. "/abc123.jpg"). When present, used as primary source. */
  tmdbPosterPath?: string | null
  /** TMDB poster size. Defaults to 342 (good for ~200px wide cards at 2x). */
  tmdbSize?: 92 | 154 | 185 | 342 | 500 | 780
}

const FallbackIcon = ({ type }: { type: ContentType }) => {
  const Icon = type === 'movie' ? Film : type === 'series' ? Tv : Radio
  return (
    <div className="w-full h-full flex items-center justify-center bg-surface-300">
      <Icon size={28} className="text-surface-700" />
    </div>
  )
}

export function Poster({ src, alt, type, className = '', tmdbPosterPath, tmdbSize = 342 }: Props) {
  // Prefer TMDB poster → M3U logo → fallback icon
  const tmdbSrc = posterUrl(tmdbPosterPath ?? null, tmdbSize)
  const primarySrc = tmdbSrc ?? src

  const [currentSrc, setCurrentSrc] = useState(primarySrc || '')
  const [failed, setFailed] = useState(!primarySrc)

  // When tmdbPosterPath arrives (async enrichment), swap the source
  const resolvedSrc = tmdbSrc ?? src
  if (resolvedSrc && resolvedSrc !== currentSrc && !failed) {
    setCurrentSrc(resolvedSrc)
  }

  if (failed) {
    return (
      <div className={className}>
        <FallbackIcon type={type} />
      </div>
    )
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={`object-cover ${className}`}
      decoding="async"
      onError={() => {
        // If TMDB poster failed, try M3U logo next
        if (currentSrc === tmdbSrc && src && src !== tmdbSrc) {
          setCurrentSrc(src)
        } else {
          setFailed(true)
        }
      }}
    />
  )
}

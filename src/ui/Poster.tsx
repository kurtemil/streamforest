import { useState, useRef, useEffect } from 'react'
import { Film, Tv, Radio } from 'lucide-react'
import { decode } from 'blurhash'
import type { ContentType } from '@/types'
import { posterUrl } from '@/services/tmdb'

interface Props {
  src: string
  alt: string
  type: ContentType
  className?: string
  tmdbPosterPath?: string | null
  tmdbSize?: 92 | 154 | 185 | 342 | 500 | 780
  blurhash?: string | null
}

const BH_W = 32
const BH_H = 48

function BlurhashCanvas({ hash }: { hash: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    try {
      const pixels = decode(hash, BH_W, BH_H)
      const ctx = canvas.getContext('2d')!
      const imageData = ctx.createImageData(BH_W, BH_H)
      imageData.data.set(pixels)
      ctx.putImageData(imageData, 0, 0)
    } catch {
      // invalid hash — ignore
    }
  }, [hash])

  return (
    <canvas
      ref={ref}
      width={BH_W}
      height={BH_H}
      className="absolute inset-0 w-full h-full"
      style={{ imageRendering: 'auto' }}
      aria-hidden="true"
    />
  )
}

const FallbackIcon = ({ type }: { type: ContentType }) => {
  const Icon = type === 'movie' ? Film : type === 'series' ? Tv : Radio
  return (
    <div className="w-full h-full flex items-center justify-center bg-surface-300">
      <Icon size={28} className="text-surface-700" />
    </div>
  )
}

export function Poster({ src, alt, type, className = '', tmdbPosterPath, tmdbSize = 342, blurhash }: Props) {
  const tmdbSrc = posterUrl(tmdbPosterPath ?? null, tmdbSize)
  const primarySrc = tmdbSrc ?? src

  const [currentSrc, setCurrentSrc] = useState(primarySrc || '')
  const [failed, setFailed] = useState(!primarySrc)
  const [loaded, setLoaded] = useState(false)

  const resolvedSrc = tmdbSrc ?? src
  if (resolvedSrc && resolvedSrc !== currentSrc) {
    setCurrentSrc(resolvedSrc)
    setLoaded(false)
    if (failed) setFailed(false)
  }

  if (failed) {
    return (
      <div className={className}>
        <FallbackIcon type={type} />
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {blurhash && !loaded && <BlurhashCanvas hash={blurhash} />}
      <img
        src={currentSrc}
        alt={alt}
        className={`absolute inset-0 w-full h-full object-cover${blurhash ? ` transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}` : ''}`}
        decoding="async"
        onLoad={blurhash ? () => setLoaded(true) : undefined}
        onError={() => {
          if (currentSrc === tmdbSrc && src && src !== tmdbSrc) {
            setCurrentSrc(src)
            setLoaded(false)
          } else {
            setFailed(true)
          }
        }}
      />
    </div>
  )
}

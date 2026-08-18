import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Info, Bookmark, Star, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Channel, TmdbMeta } from '@/types'
import { backdropUrl, posterUrl } from '@/services/tmdb'
import { heroCrossfade } from '@/styles/motion'

interface HeroItem {
  channel: Channel
  tmdbMeta: TmdbMeta
}

interface Props {
  items: HeroItem[]
  onPlay: (channel: Channel) => void
  onMoreInfo: (channel: Channel) => void
  onWatchLater: (channel: Channel) => void
  isWatchLater: (channel: Channel) => boolean
}

const ROTATE_INTERVAL = 9000 // ms between auto-advances

export function Hero({ items, onPlay, onMoreInfo, onWatchLater, isWatchLater }: Props) {
  const [idx, setIdx] = useState(0)
  const timer = useRef<number | null>(null)

  const startTimer = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = window.setInterval(() => {
      setIdx((i) => (i + 1) % items.length)
    }, ROTATE_INTERVAL)
  }

  useEffect(() => {
    if (items.length < 2) return
    startTimer()
    return () => { if (timer.current) clearInterval(timer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length])

  if (!items.length) return null

  const { channel, tmdbMeta } = items[idx]
  const backdrop = backdropUrl(tmdbMeta.backdropPath, 1280)
  // Not every title has a landscape backdrop, and without one the whole hero used
  // to be skipped — so the home screen opened on a bare row heading whenever the
  // newest titles happened to lack one. A poster blown up and blurred behind the
  // sharp poster is the standard fallback, and it carries the film's own colour
  // into the page, which is the point of a hero in the first place.
  const poster = posterUrl(tmdbMeta.posterPath, 500) ?? channel.logo ?? null
  const usingPosterFallback = !backdrop && !!poster
  const wl = isWatchLater(channel)

  const genres = tmdbMeta.genres?.slice(0, 3) ?? []
  const runtime = tmdbMeta.runtime
    ? tmdbMeta.runtime >= 60
      ? `${Math.floor(tmdbMeta.runtime / 60)}h ${tmdbMeta.runtime % 60}m`
      : `${tmdbMeta.runtime}m`
    : null

  return (
    <div className="group relative w-full h-[58vh] min-h-[380px] max-h-[640px] overflow-hidden select-none">
      {/* Backdrop */}
      <AnimatePresence mode="sync">
        <motion.div
          key={`bg-${idx}`}
          variants={heroCrossfade}
          initial="initial"
          animate="enter"
          exit="exit"
          className="absolute inset-0"
        >
          {backdrop ? (
            <img
              src={backdrop}
              alt=""
              aria-hidden="true"
              className="w-full h-full object-cover animate-kenburns"
              decoding="async"
            />
          ) : poster ? (
            <img
              src={poster}
              alt=""
              aria-hidden="true"
              className="w-full h-full object-cover scale-150 blur-3xl saturate-[1.7] opacity-95 animate-kenburns"
              decoding="async"
            />
          ) : (
            <div className="w-full h-full bg-surface-300" />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Gradient overlays. The horizontal one is tuned for a photographic
          backdrop; over a blurred poster it removed the only colour on screen. */}
      <div className="absolute inset-0 vignette-bottom" />
      <div className={usingPosterFallback ? 'absolute inset-0 vignette-left opacity-50' : 'absolute inset-0 vignette-left'} />
      {/* Extra bottom fade for content legibility */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-surface-100 to-transparent" />

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`content-${idx}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] } }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.25 } }}
          className="absolute bottom-0 left-0 right-0 px-8 pb-10 flex items-end gap-7 max-w-3xl"
        >
          {usingPosterFallback && poster && (
            <img
              src={poster}
              alt=""
              aria-hidden="true"
              className="hidden sm:block w-36 lg:w-44 aspect-[2/3] object-cover rounded-card-lg ring-1 ring-white/15 shadow-cinema shrink-0"
              decoding="async"
            />
          )}
          <div className="flex flex-col gap-4 min-w-0">
          {/* Meta chips */}
          <div className="flex items-center gap-2 flex-wrap">
            {tmdbMeta.year && (
              <span className="text-micro font-semibold text-neutral-300 tracking-widest uppercase">{tmdbMeta.year}</span>
            )}
            {tmdbMeta.rating > 0 && (
              <span className="flex items-center gap-1 text-micro font-semibold text-neutral-300">
                <Star size={10} fill="#f59e0b" className="text-warn-500" />
                {tmdbMeta.rating.toFixed(1)}
              </span>
            )}
            {runtime && (
              <span className="flex items-center gap-1 text-micro text-neutral-400">
                <Clock size={10} />
                {runtime}
              </span>
            )}
            {genres.map((g) => (
              <span key={g} className="text-micro text-neutral-500 px-2 py-0.5 rounded-full ring-1 ring-white/15">{g}</span>
            ))}
          </div>

          {/* Title */}
          <h1 className="text-display-xl text-white leading-none drop-shadow-lg">
            {tmdbMeta.title}
          </h1>

          {/* Synopsis */}
          {tmdbMeta.overview && (
            <p className="text-body text-neutral-300 leading-relaxed line-clamp-2 max-w-lg drop-shadow">
              {tmdbMeta.overview}
            </p>
          )}

          {/* CTAs */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => onPlay(channel)}
              className="flex items-center gap-2 px-6 py-3 bg-white hover:bg-neutral-100 rounded-lg text-black font-semibold text-body transition-all active:scale-95 shadow-cinema"
            >
              <Play size={16} fill="black" />
              Play
            </button>
            <button
              onClick={() => onMoreInfo(channel)}
              className="flex items-center gap-2 px-5 py-3 bg-white/15 hover:bg-white/22 backdrop-blur-md rounded-lg text-white font-medium text-body transition-all active:scale-95 ring-1 ring-white/20"
            >
              <Info size={16} />
              More Info
            </button>
            <button
              onClick={() => onWatchLater(channel)}
              title={wl ? 'Remove from Watch Later' : 'Add to Watch Later'}
              className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md transition-all active:scale-95 ring-1 ${
                wl
                  ? 'bg-accent-600/80 ring-accent-500/60'
                  : 'bg-white/15 hover:bg-white/22 ring-white/20'
              }`}
            >
              <Bookmark size={16} fill={wl ? 'white' : 'none'} className="text-white" />
            </button>
          </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Side arrows + dot indicators */}
      {items.length > 1 && (
        <>
          <button
            onClick={() => { setIdx((idx - 1 + items.length) % items.length); startTimer() }}
            aria-label="Previous"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 hover:bg-black/75 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20 transition-all opacity-0 hover:opacity-100 group-hover:opacity-100 focus:opacity-100"
          >
            <ChevronLeft size={20} className="text-white" />
          </button>
          <button
            onClick={() => { setIdx((idx + 1) % items.length); startTimer() }}
            aria-label="Next"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 hover:bg-black/75 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20 transition-all opacity-0 hover:opacity-100 group-hover:opacity-100 focus:opacity-100"
          >
            <ChevronRight size={20} className="text-white" />
          </button>
          {/* The dot stays 6px — that is the design. The button around it is a
              44px square of transparent padding, because that is what a thumb
              actually aims at. Negative margins keep the row's spacing unchanged. */}
          <div className="absolute bottom-4 right-8 flex items-center gap-1.5">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => { setIdx(i); startTimer() }}
                className="grid place-items-center w-11 h-11 -mx-[1.1rem] -my-[1.1rem] group/dot"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === idx ? 'true' : undefined}
              >
                <span
                  className={`rounded-full transition-all duration-300 ${
                    i === idx ? 'w-5 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/30 group-hover/dot:bg-white/60'
                  }`}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

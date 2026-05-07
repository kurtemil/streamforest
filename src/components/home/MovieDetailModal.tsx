import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Play, Bookmark, Star, Clock, Users } from 'lucide-react'
import type { Channel, TmdbMeta } from '@/types'
import { backdropUrl, posterUrl, profileUrl } from '@/services/tmdb'

interface Props {
  channel: Channel | null
  tmdbMeta: TmdbMeta | null
  isWatchLater: boolean
  onClose: () => void
  onPlay: () => void
  onWatchLater: () => void
}

export function MovieDetailModal({ channel, tmdbMeta, isWatchLater, onClose, onPlay, onWatchLater }: Props) {
  const open = channel !== null

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const backdrop = backdropUrl(tmdbMeta?.backdropPath ?? null, 1280)
  const poster   = posterUrl(tmdbMeta?.posterPath ?? null, 342)
  const fallbackPoster = channel?.logo ?? ''

  const runtime = tmdbMeta?.runtime
    ? tmdbMeta.runtime >= 60
      ? `${Math.floor(tmdbMeta.runtime / 60)}h ${tmdbMeta.runtime % 60}m`
      : `${tmdbMeta.runtime}m`
    : null

  const title = tmdbMeta?.title ?? channel?.movieTitle ?? channel?.showName ?? channel?.name ?? ''

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop scrim */}
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal panel */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 0, y: 20, scale: 0.97, transition: { duration: 0.22 } }}
            className="fixed inset-x-4 top-6 bottom-6 z-40 md:inset-x-[10%] lg:inset-x-[15%] xl:inset-x-[20%] rounded-2xl overflow-hidden flex flex-col bg-surface-200 shadow-cinema ring-1 ring-white/8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Backdrop header */}
            <div className="relative h-64 shrink-0 overflow-hidden bg-surface-300">
              {backdrop && (
                <img src={backdrop} alt="" aria-hidden="true" className="w-full h-full object-cover" decoding="async" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-surface-200 via-surface-200/40 to-transparent" />

              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20 transition-colors"
              >
                <X size={16} className="text-white" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 pb-8 -mt-16 relative">
              <div className="flex gap-5 items-end mb-6">
                {/* Poster */}
                <div className="w-24 aspect-[2/3] rounded-lg overflow-hidden shrink-0 ring-1 ring-white/15 shadow-cinema bg-surface-300">
                  <img
                    src={poster ?? fallbackPoster}
                    alt={title}
                    className="w-full h-full object-cover"
                    decoding="async"
                    onError={(e) => { (e.target as HTMLImageElement).src = fallbackPoster }}
                  />
                </div>

                {/* Title block */}
                <div className="flex-1 min-w-0 pb-1">
                  <h2 className="text-heading-xl text-white leading-tight mb-1">{title}</h2>
                  <div className="flex items-center gap-3 flex-wrap text-caption text-neutral-400">
                    {tmdbMeta?.year && <span>{tmdbMeta.year}</span>}
                    {runtime && (
                      <span className="flex items-center gap-1"><Clock size={11} />{runtime}</span>
                    )}
                    {tmdbMeta?.rating && tmdbMeta.rating > 0 && (
                      <span className="flex items-center gap-1">
                        <Star size={11} fill="#f59e0b" className="text-warn-500" />
                        {tmdbMeta.rating.toFixed(1)}
                      </span>
                    )}
                    {tmdbMeta?.genres?.slice(0, 3).map((g) => (
                      <span key={g} className="px-1.5 py-0.5 rounded-full ring-1 ring-white/15 text-neutral-500">{g}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* CTAs */}
              <div className="flex gap-3 mb-6">
                <button
                  onClick={onPlay}
                  className="flex items-center gap-2 px-6 py-2.5 bg-white hover:bg-neutral-100 rounded-lg text-black font-semibold text-body transition-all active:scale-95"
                >
                  <Play size={16} fill="black" />
                  Play
                </button>
                <button
                  onClick={onWatchLater}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-body transition-all active:scale-95 ring-1 ${
                    isWatchLater
                      ? 'bg-accent-600/20 ring-accent-600/40 text-accent-400'
                      : 'bg-white/8 ring-white/15 text-neutral-300 hover:bg-white/12'
                  }`}
                >
                  <Bookmark size={15} fill={isWatchLater ? 'currentColor' : 'none'} />
                  {isWatchLater ? 'Saved' : 'Watch Later'}
                </button>
              </div>

              {/* Overview */}
              {tmdbMeta?.overview && (
                <p className="text-body text-neutral-300 leading-relaxed mb-6">{tmdbMeta.overview}</p>
              )}

              {/* Director */}
              {tmdbMeta?.director && (
                <p className="text-caption text-neutral-500 mb-5">
                  <span className="text-neutral-400 font-medium">Director: </span>{tmdbMeta.director}
                </p>
              )}

              {/* Cast */}
              {tmdbMeta?.cast && tmdbMeta.cast.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center gap-1.5 mb-3">
                    <Users size={13} className="text-neutral-500" />
                    <span className="text-caption font-medium text-neutral-400 uppercase tracking-wider">Cast</span>
                  </div>
                  <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                    {tmdbMeta.cast.map((member) => (
                      <div key={member.name} className="flex-shrink-0 w-16 text-center">
                        <div className="w-16 h-16 rounded-full overflow-hidden bg-surface-400 ring-1 ring-white/10 mb-1.5 mx-auto">
                          {member.profilePath ? (
                            <img
                              src={profileUrl(member.profilePath, 92) ?? ''}
                              alt={member.name}
                              className="w-full h-full object-cover"
                              decoding="async"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-600 text-heading-md font-bold">
                              {member.name[0]}
                            </div>
                          )}
                        </div>
                        <p className="text-micro text-white font-medium line-clamp-1">{member.name}</p>
                        <p className="text-micro text-neutral-600 line-clamp-1">{member.character}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

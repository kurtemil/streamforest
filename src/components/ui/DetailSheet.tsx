import { useEffect, useRef, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Star, Clock, Users } from 'lucide-react'
import { useT } from '@/lib/i18n'

export interface DetailCastMember {
  name: string
  character?: string
  image?: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  title: string
  backdrop?: string | null
  poster?: string | null
  /** Shown when `poster` is missing or fails to load. */
  fallbackPoster?: string
  year?: number | null
  runtime?: string | null
  rating?: number | null
  /** Small chips after the facts: genres, an age limit, the source. */
  chips?: string[]
  /** Where playback stands, under the title: a bar and what is left. */
  progress?: { pct: number; label: string } | null
  actions: ReactNode
  overview?: string | null
  director?: string | null
  cast?: DetailCastMember[]
  /** More sections under the cast: what is like this one. */
  after?: ReactNode
}

/**
 * The sheet a title opens in before anything plays: artwork, facts, what to do,
 * what it is about. One shell for both sources, so a film from the home server and
 * one from the provider look like the same kind of thing. Who fills it decides the
 * data and the buttons; this only lays them out.
 */
export function DetailSheet({
  open, onClose, title, backdrop, poster, fallbackPoster = '', year, runtime, rating, chips,
  progress, actions, overview, director, cast, after,
}: Props) {
  const t = useT()
  // A related title opens in the same sheet; it should start at its top, not
  // wherever the previous one was scrolled to.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [title])

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
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 0, y: 20, scale: 0.97, transition: { duration: 0.22 } }}
            className="fixed inset-x-4 top-6 bottom-6 z-40 md:inset-x-[10%] lg:inset-x-[15%] xl:inset-x-[20%] rounded-2xl overflow-hidden flex flex-col bg-surface-200 shadow-cinema outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Backdrop header */}
            <div className="relative h-64 shrink-0 overflow-hidden bg-surface-300">
              {backdrop && (
                <img src={backdrop} alt="" aria-hidden="true" className="w-full h-full object-cover" decoding="async" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-surface-200 via-surface-200/40 to-transparent" />

              <button
                onClick={onClose}
                aria-label={t('common.close')}
                className="absolute top-4 right-4 w-11 h-11 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20 transition-colors"
              >
                <X size={16} className="text-white" />
              </button>
            </div>

            {/* Scrollable content */}
            <div ref={scroller} className="flex-1 overflow-y-auto px-6 pb-8 -mt-16 relative">
              <div className="flex gap-5 items-end mb-6">
                {/* Poster */}
                <div className="w-24 aspect-[2/3] rounded-lg overflow-hidden shrink-0 ring-1 ring-white/15 shadow-cinema bg-surface-300">
                  {(poster || fallbackPoster) && (
                    <img
                      src={poster || fallbackPoster}
                      alt={title}
                      className="w-full h-full object-cover"
                      decoding="async"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement
                        if (fallbackPoster && img.src !== fallbackPoster) img.src = fallbackPoster
                      }}
                    />
                  )}
                </div>

                {/* Title block */}
                <div className="flex-1 min-w-0 pb-1">
                  <h2 className="text-heading-xl text-white leading-tight mb-1">{title}</h2>
                  <div className="flex items-center gap-3 flex-wrap text-caption text-neutral-400">
                    {year && <span>{year}</span>}
                    {runtime && (
                      <span className="flex items-center gap-1"><Clock size={11} />{runtime}</span>
                    )}
                    {rating != null && rating > 0 && (
                      <span className="flex items-center gap-1">
                        <Star size={11} fill="#f59e0b" className="text-warn-500" />
                        {rating.toFixed(1)}
                      </span>
                    )}
                    {chips?.map((g) => (
                      <span key={g} className="px-1.5 py-0.5 rounded-full ring-1 ring-white/15 text-neutral-500">{g}</span>
                    ))}
                  </div>
                </div>
              </div>

              {progress && (
                <div className="flex items-center gap-3 mb-4 max-w-sm">
                  <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-accent-400 rounded-full" style={{ width: `${progress.pct}%` }} />
                  </div>
                  <span className="text-caption text-neutral-400 shrink-0">{progress.label}</span>
                </div>
              )}

              {/* CTAs */}
              <div className="flex flex-wrap gap-3 mb-6">{actions}</div>

              {overview && (
                <p className="text-body text-neutral-300 leading-relaxed mb-6">{overview}</p>
              )}

              {director && (
                <p className="text-caption text-neutral-500 mb-5">
                  <span className="text-neutral-400 font-medium">{t('modal.director')} </span>{director}
                </p>
              )}

              {cast && cast.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center gap-1.5 mb-3">
                    <Users size={13} className="text-neutral-500" />
                    <span className="text-caption font-medium text-neutral-400 uppercase tracking-wider">{t('modal.cast')}</span>
                  </div>
                  <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                    {cast.map((member) => (
                      <div key={member.name} className="flex-shrink-0 w-16 text-center">
                        <div className="w-16 h-16 rounded-full overflow-hidden bg-surface-400 ring-1 ring-white/10 mb-1.5 mx-auto">
                          {member.image ? (
                            <img src={member.image} alt={member.name} className="w-full h-full object-cover" decoding="async" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-600 text-heading-md font-bold">
                              {member.name[0]}
                            </div>
                          )}
                        </div>
                        <p className="text-micro text-white font-medium line-clamp-1">{member.name}</p>
                        {member.character && <p className="text-micro text-neutral-600 line-clamp-1">{member.character}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {after}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/** The look every button in the sheet's action row shares. */
export function sheetButton(kind: 'primary' | 'secondary' | 'active'): string {
  const base = 'flex items-center gap-2 min-h-11 rounded-lg font-medium text-body transition-all active:scale-95'
  if (kind === 'primary') return `${base} px-6 bg-white hover:bg-neutral-100 text-black font-semibold`
  if (kind === 'active') return `${base} px-4 ring-1 bg-accent-600/20 ring-accent-600/40 text-accent-400`
  return `${base} px-4 ring-1 bg-white/8 ring-white/15 text-neutral-300 hover:bg-white/12`
}

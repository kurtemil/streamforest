import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { ease, dur } from '@/styles/motion'
import { useT } from '@/lib/i18n'

type Size = 'sm' | 'md' | 'lg' | 'xl' | 'full'

interface Props {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  size?: Size
  /** If true, clicking the backdrop does not close. */
  persistent?: boolean
  className?: string
}

const SIZE: Record<Size, string> = {
  sm:   'max-w-sm',
  md:   'max-w-md',
  lg:   'max-w-lg',
  xl:   'max-w-2xl',
  full: 'max-w-full m-4',
}

const backdropVariants = {
  initial: { opacity: 0 },
  enter:   { opacity: 1, transition: { duration: dur.fast } },
  exit:    { opacity: 0, transition: { duration: dur.fast } },
}

const panelVariants = {
  initial: { opacity: 0, y: 16, scale: 0.97 },
  enter:   { opacity: 1, y: 0, scale: 1, transition: { duration: dur.base, ease: ease.out } },
  exit:    { opacity: 0, y: 8, scale: 0.98, transition: { duration: dur.fast, ease: ease.out } },
}

export function Dialog({ open, onClose, title, children, size = 'md', persistent = false, className = '' }: Props) {
  const t = useT()
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          variants={backdropVariants}
          initial="initial"
          animate="enter"
          exit="exit"
        >
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={persistent ? undefined : onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            variants={panelVariants}
            className={`relative w-full ${SIZE[size]} bg-surface-200 rounded-2xl shadow-cinema overflow-hidden outline-none ${className}`}
          >
            {title != null && (
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/6">
                <div className="text-heading-md text-white">{title}</div>
                <button
                  onClick={onClose}
                  className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/8 transition-colors"
                  aria-label={t('common.close')}
                >
                  <X size={18} />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

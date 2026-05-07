import { motion } from 'framer-motion'
import { type ReactNode } from 'react'
import { pageVariants } from '@/styles/motion'

interface Props {
  children: ReactNode
  className?: string
}

/**
 * Wraps a page's root element with the standard fade+lift transition.
 * Used inside `<AnimatePresence mode="wait">` keyed by `location.pathname`.
 */
export function PageTransition({ children, className = '' }: Props) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="enter"
      exit="exit"
      className={`min-h-full ${className}`}
    >
      {children}
    </motion.div>
  )
}

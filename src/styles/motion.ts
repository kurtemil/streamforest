/* Centralised motion presets for framer-motion across the app.
   Keep all transitions consistent so the app feels like one piece. */

import type { Transition, Variants } from 'framer-motion'

export const ease = {
  out:   [0.16, 1, 0.3, 1]      as const,
  inOut: [0.65, 0, 0.35, 1]     as const,
  spring: [0.34, 1.56, 0.64, 1] as const,
  snappy: [0.25, 0.46, 0.45, 0.94] as const,
}

export const dur = {
  instant: 0.1,
  fast:    0.18,
  base:    0.26,
  slow:    0.42,
  cinema:  0.72,
}

// Page transition: subtle fade + lift. Used by AnimatePresence on the route.
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  enter:   { opacity: 1, y: 0,  transition: { duration: dur.base, ease: ease.out } },
  exit:    { opacity: 0, y: -4, transition: { duration: dur.fast, ease: ease.out } },
}

// Card hover spring (used in Poster, MovieCard).
export const cardHover: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 26,
  mass: 0.7,
}

// Hero crossfade between rotating spotlight slides.
export const heroCrossfade: Variants = {
  initial: { opacity: 0, scale: 1.04 },
  enter:   { opacity: 1, scale: 1,    transition: { duration: dur.cinema, ease: ease.out } },
  exit:    { opacity: 0, scale: 0.99, transition: { duration: dur.slow,   ease: ease.out } },
}

// Generic stagger for lists of cards entering.
export const stagger = (amount = 0.04): Variants => ({
  initial: {},
  enter:   { transition: { staggerChildren: amount, delayChildren: 0.05 } },
  exit:    {},
})

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 12 },
  enter:   { opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.out } },
  exit:    { opacity: 0, y: -4, transition: { duration: dur.fast, ease: ease.out } },
}

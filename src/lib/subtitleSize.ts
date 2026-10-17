// How big subtitles are drawn, per profile (feedback box, 2026-10-15).
//
// They were a fixed 16 px. On a phone that is fine; on a laptop in fullscreen it
// is a line of small print, and on the projector the kiosk will drive it is
// unreadable from the sofa. So each size grows with the screen, between a floor
// that stays legible on a phone and a ceiling that stays a subtitle on a TV.

export type SubtitleSize = 's' | 'm' | 'l' | 'xl'

export const SUBTITLE_SIZES: readonly SubtitleSize[] = ['s', 'm', 'l', 'xl']

const FONT: Record<SubtitleSize, string> = {
  s: 'clamp(0.875rem, 1.7vw, 1.75rem)',
  m: 'clamp(1rem, 2.2vw, 2.25rem)',
  l: 'clamp(1.25rem, 2.9vw, 2.875rem)',
  xl: 'clamp(1.5rem, 3.7vw, 3.5rem)',
}

export function subtitleFont(size: SubtitleSize | undefined): string {
  return FONT[size && size in FONT ? size : 'm']
}

export function isSubtitleSize(v: unknown): v is SubtitleSize {
  return typeof v === 'string' && (SUBTITLE_SIZES as readonly string[]).includes(v)
}

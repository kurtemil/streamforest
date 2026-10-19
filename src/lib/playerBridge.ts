// The kiosk's hold on whichever player is open: HomePlayer (the home library) or
// VideoPlayer (IPTV). The player registers itself here, and the kiosk pauses,
// seeks, closes and reads the position through it. Both players count in film
// time — across the parts of a split film, and past the offset a transcoded
// stream starts at — so the phone never has to know which one is playing.

export interface PlayerBridge {
  video: HTMLVideoElement
  /** Seconds into the whole film. */
  position: () => number
  /** The whole film. 0 when unknown, and for live TV. */
  duration: () => number
  /** To a point in film time, the way the player's own scrubber would. */
  seek: (to: number) => void
  /** Ends playback the way the player's close button does, position saved. */
  close: () => void
  live: boolean
  /** Set by the player when it could not open what it was given. */
  failed?: boolean
}

let current: PlayerBridge | null = null

export function setPlayerBridge(bridge: PlayerBridge): void {
  current = bridge
}

/** Only the player that registered may take its bridge down: the next one may already be up. */
export function clearPlayerBridge(video: HTMLVideoElement): void {
  if (current?.video === video) current = null
}

export function getPlayerBridge(): PlayerBridge | null {
  return current
}

export function markPlayerFailed(video: HTMLVideoElement): void {
  if (current?.video === video) current = { ...current, failed: true }
}

/** Where a relative seek lands. Never before the start or past the end. */
export function seekTarget(position: number, by: number, duration: number): number {
  const end = Number.isFinite(duration) && duration > 0 ? duration - 1 : Infinity
  return Math.max(0, Math.min(end, position + by))
}

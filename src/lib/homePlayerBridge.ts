// The kiosk's hold on the home player: HomePlayer registers the <video> it is
// playing, and the kiosk pauses, seeks and reads the position through it. A film in
// several files is one film to the phone, so the bridge also carries where the
// current file starts in the film and how long the whole film is.

export interface HomePlayerBridge {
  video: HTMLVideoElement
  /** Seconds of the film before the file that is playing. */
  offset: number
  /** The whole film, all parts. 0 when unknown. */
  duration: number
  /** Set by the player when the file could not be opened. */
  failed?: boolean
}

let current: HomePlayerBridge | null = null

export function setHomePlayerBridge(bridge: HomePlayerBridge | null): void {
  current = bridge
}

export function getHomePlayerBridge(): HomePlayerBridge | null {
  return current
}

/** Where a relative seek lands in the file that is playing. Never before its start or past its end. */
export function seekTarget(currentTime: number, by: number, fileDuration: number): number {
  const end = Number.isFinite(fileDuration) && fileDuration > 0 ? fileDuration - 1 : Infinity
  return Math.max(0, Math.min(end, currentTime + by))
}

/** The player could not open the file it registered. */
export function markHomePlayerFailed(video: HTMLVideoElement): void {
  if (current?.video === video) current = { ...current, failed: true }
}

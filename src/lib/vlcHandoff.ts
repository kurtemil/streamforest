// A title handed to VLC, remembered until the app is in front again.
//
// VLC for iOS never says where playback stopped: its x-callback opens a return
// link with nothing appended (vlc-ios#1089, open since 2015), and it keeps its
// resume point to itself. A computer without the reporting handler says nothing
// either. So on return the app asks: here is how long you were away, is that
// where you got to? It is a guess offered for a yes, never written on its own.
// Where the handler did report, the row is already newer than the handoff and
// nothing is asked.

export interface Handoff {
  at: number
  kind: 'sf' | 'jf'
  profileId: string
  title: string
  /** A channel id for 'sf', the Jellyfin item for 'jf'. */
  id: string
  /** Where VLC was told to start, in seconds of the whole title. */
  start: number
  durationSec: number | null
}

const KEY = 'sf-vlc-handoff'
/** Coming back sooner than this is not having watched anything. */
export const MIN_AWAY_MS = 45_000
/** A handoff older than this is a different evening; let it go without asking. */
export const MAX_AWAY_MS = 12 * 60 * 60 * 1000
/** Getting VLC going and the film started takes a moment that is not watching. */
const STARTUP_SEC = 15

export function rememberHandoff(h: Handoff): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(h)) } catch { /* private mode: no question afterwards */ }
}

export function pendingHandoff(): Handoff | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as Handoff : null
  } catch {
    return null
  }
}

export function clearHandoff(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}

/** Where the time away says playback got to, never past the end. */
export function estimatePosition(h: Handoff, now: number): number {
  const watched = Math.max(0, (now - h.at) / 1000 - STARTUP_SEC)
  const at = h.start + watched
  return Math.round(h.durationSec ? Math.min(at, h.durationSec) : at)
}

// Talking to the kiosk in the basement ("Bion") through /api/bion. The phone sends
// commands and reads the status; the kiosk reads commands and writes the status.
// See functions/api/bion.ts for why this is polling and not a socket.

const API = '/api/bion'

/** The one kiosk there is. A second screen would be a second device name. */
export const BION_DEVICE = 'bion'

/** Where a film comes from: the home server's Jellyfin, or the IPTV playlist. */
export type BionSource = 'home' | 'iptv'

export type BionCommand =
  | { type: 'play'; source?: BionSource; profileId: string; itemId: string; fromStart?: boolean }
  | { type: 'pause' }
  | { type: 'resume' }
  /** A step from where the film is (`by`), or a point in it (`to`, the scrubber). */
  | { type: 'seek'; by: number; to?: undefined }
  | { type: 'seek'; to: number; by?: undefined }
  | { type: 'stop' }
  /** A track by the id the status lists it with. -1 turns subtitles off. */
  | { type: 'audio'; id: number }
  | { type: 'subtitle'; id: number }
  /**
   * Sent by Home Assistant while the projector warms up: keep the film still at its
   * start until a `resume`, or until HOLD_MS has passed. The phone never sends it.
   */
  | { type: 'hold' }

/** `waiting`: the film is ready but held while the projector warms up. */
export type BionState = 'idle' | 'loading' | 'waiting' | 'playing' | 'paused' | 'failed'

/** An audio or subtitle track, as the kiosk's player names it. */
export interface BionTrack { id: number; name: string }

export interface BionStatus {
  state: BionState
  source?: BionSource
  /** Live TV: no length, and nothing to seek in. */
  live?: boolean
  profileId?: string
  itemId?: string
  title?: string
  /** Seconds into the whole film, across its parts. */
  position?: number
  duration?: number
  /** What the film offers, and what is on. Missing when there is nothing to choose between. */
  audio?: BionTrack[]
  audioActive?: number
  subtitles?: BionTrack[]
  /** -1: subtitles off. */
  subtitleActive?: number
  /** Server time of the kiosk's last write, set by the API. */
  updated?: number
}

export interface BionPoll {
  /** Server time, to judge `status.updated` by the same clock. */
  now: number
  latest: number
  commands: (BionCommand & { seq: number })[]
  status: BionStatus | null
}

export async function pollBion(after?: number): Promise<BionPoll | null> {
  const q = new URLSearchParams({ device: BION_DEVICE })
  if (after !== undefined) q.set('after', String(after))
  try {
    const res = await fetch(`${API}?${q}`, { cache: 'no-store' })
    return res.ok ? await res.json() as BionPoll : null
  } catch {
    return null
  }
}

export async function sendBion(command: BionCommand): Promise<boolean> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: BION_DEVICE, command }),
    })
    return res.ok
  } catch {
    return false
  }
}

export function putBionStatus(status: Omit<BionStatus, 'updated'>): void {
  fetch(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device: BION_DEVICE, status }),
  }).catch(() => {})
}

/** How long a status counts as current. The kiosk writes every five seconds while a film is on. */
export const STATUS_FRESH_MS = 20_000

/** Whether the phone should show the remote: something is on, and the kiosk said so recently. */
export function isBionActive(status: BionStatus | null, now: number): boolean {
  if (!status || status.updated === undefined) return false
  if (now - status.updated > STATUS_FRESH_MS) return false
  return status.state === 'loading' || status.state === 'waiting' || status.state === 'playing' || status.state === 'paused'
}

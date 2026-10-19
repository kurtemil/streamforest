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
  | { type: 'seek'; by: number }
  | { type: 'stop' }

export type BionState = 'idle' | 'loading' | 'playing' | 'paused' | 'failed'

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
  return status.state === 'loading' || status.state === 'playing' || status.state === 'paused'
}

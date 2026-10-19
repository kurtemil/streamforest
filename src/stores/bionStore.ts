import { create } from 'zustand'
import { isBionActive, pollBion, sendBion, STATUS_FRESH_MS, type BionCommand, type BionStatus } from '@/services/bion'
import type { HomeItem } from '@/services/jellyfin'

/** How long "starting on Bion" is shown before the kiosk's own status has to take over. */
const PENDING_MS = 15_000

interface BionState {
  status: BionStatus | null
  /** Server clock minus this device's, from the last poll: `status.updated` is server time. */
  clockSkew: number
  /** A film just sent, shown until the kiosk reports it. */
  pending: { title: string; at: number } | null
  failed: boolean
  poll: () => Promise<void>
  /** Starts a home film on Bion as this profile, where this profile left it unless `fromStart`. */
  play: (item: HomeItem, profileId: string, fromStart?: boolean) => Promise<boolean>
  send: (command: Exclude<BionCommand, { type: 'play' }>) => Promise<void>
}

export const useBionStore = create<BionState>((set, get) => ({
  status: null,
  clockSkew: 0,
  pending: null,
  failed: false,

  async poll() {
    const result = await pollBion()
    if (!result) return
    const pending = get().pending
    // The kiosk has taken the film over once it reports anything but idle after it was sent.
    const reported = result.status && result.status.updated !== undefined && pending &&
      result.status.state !== 'idle' && result.status.updated >= pending.at + get().clockSkew
    set({
      status: result.status,
      clockSkew: result.now - Date.now(),
      pending: reported || (pending && Date.now() - pending.at > PENDING_MS) ? null : pending,
    })
  },

  async play(item, profileId, fromStart) {
    set({ pending: { title: item.name, at: Date.now() }, failed: false })
    const ok = await sendBion({ type: 'play', profileId, itemId: item.id, fromStart })
    if (!ok) set({ pending: null, failed: true })
    return ok
  },

  async send(command) {
    // Shown at once; the next poll puts back whatever the kiosk actually did.
    const status = get().status
    if (status) {
      if (command.type === 'pause') set({ status: { ...status, state: 'paused' } })
      if (command.type === 'resume') set({ status: { ...status, state: 'playing' } })
      if (command.type === 'seek' && status.position !== undefined) {
        set({ status: { ...status, position: Math.max(0, status.position + command.by) } })
      }
      if (command.type === 'stop') set({ status: { ...status, state: 'idle' }, pending: null })
    }
    const ok = await sendBion(command)
    set({ failed: !ok })
  },
}))

/** Whether the remote should be on screen, by this device's clock. */
export function bionVisible(s: Pick<BionState, 'status' | 'clockSkew' | 'pending'>, now = Date.now()): boolean {
  if (s.pending && now - s.pending.at <= PENDING_MS) return true
  // A film the kiosk could not start stays on screen long enough to be read.
  const st = s.status
  if (st?.state === 'failed' && st.updated !== undefined && now + s.clockSkew - st.updated <= STATUS_FRESH_MS) return true
  return isBionActive(st, now + s.clockSkew)
}

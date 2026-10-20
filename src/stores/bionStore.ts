import { create } from 'zustand'
import {
  isBionActive, pollBion, sendBion, STATUS_FRESH_MS, type BionCommand, type BionStatus, type ReceiverStatus,
} from '@/services/bion'
import { isKiosk } from '@/lib/kiosk'
import type { HomeItem } from '@/services/jellyfin'
import type { Channel } from '@/types'

/** How long "starting on Bion" is shown before the kiosk's own status has to take over. */
const PENDING_MS = 15_000
/** The kiosk writes its idle status every minute; this is how long it counts as switched on. */
export const ALIVE_MS = 150_000
const MODE_KEY = 'sf-bion-mode'
/** How long a level just sent is shown before HA's own report of the receiver has to agree. */
const VOLUME_HELD_MS = 5_000
/** One tap on the remote: a step in HA's scale, which is one dB. */
export const VOLUME_STEP = 0.02

function readMode(): boolean {
  try { return !isKiosk() && localStorage.getItem(MODE_KEY) === '1' } catch { return false }
}

interface BionState {
  /**
   * Bion mode, per device: every Play in the app goes to the kiosk in the basement
   * instead of playing here. An old iPad can stay in it and be the cinema's remote.
   * Never on the kiosk itself, which would send its films to itself.
   */
  mode: boolean
  status: BionStatus | null
  /** Server clock minus this device's, from the last poll: `status.updated` is server time. */
  clockSkew: number
  /** A film just sent, shown until the kiosk reports it. */
  pending: { title: string; at: number } | null
  failed: boolean
  /** The receiver, as Home Assistant last wrote it. */
  receiver: ReceiverStatus | null
  /** A level just sent, shown until HA reports the receiver at it. */
  volumeHeld: { to: number; at: number } | null
  setMode: (on: boolean) => void
  /** The receiver to a level, 0–1. */
  setVolume: (to: number) => Promise<void>
  poll: () => Promise<void>
  /** A home-library film, as this profile, where this profile left it unless `fromStart`. */
  playHome: (item: HomeItem, profileId: string, fromStart?: boolean) => Promise<boolean>
  /** An IPTV film, episode or channel, by the id every device parses from the playlist. */
  playIptv: (channel: Channel, profileId: string) => Promise<boolean>
  send: (command: Exclude<BionCommand, { type: 'play' | 'hold' | 'volume' }>) => Promise<void>
}

/** What the phone shows while it waits: the film's name, as the cards show it. */
export function channelTitle(c: Channel): string {
  if (c.type === 'series' && c.showName) {
    const s = c.season !== undefined ? `S${String(c.season).padStart(2, '0')}` : ''
    const e = c.episode !== undefined ? `E${String(c.episode).padStart(2, '0')}` : ''
    return `${c.showName}${s || e ? ` · ${s}${e}` : ''}`
  }
  return c.movieTitle ?? c.name
}

export const useBionStore = create<BionState>((set, get) => {
  const start = async (title: string, command: Extract<BionCommand, { type: 'play' }>) => {
    set({ pending: { title, at: Date.now() }, failed: false })
    const ok = await sendBion(command)
    if (!ok) set({ pending: null, failed: true })
    return ok
  }

  return {
    mode: readMode(),
    status: null,
    clockSkew: 0,
    pending: null,
    failed: false,
    receiver: null,
    volumeHeld: null,

    setMode(on) {
      if (isKiosk()) return
      try { if (on) localStorage.setItem(MODE_KEY, '1'); else localStorage.removeItem(MODE_KEY) } catch { /* the choice lasts the visit */ }
      set({ mode: on, failed: false })
    },

    async poll() {
      const result = await pollBion()
      if (!result) return
      const pending = get().pending
      // The kiosk has taken the film over once it reports anything but idle after it was sent.
      const reported = result.status && result.status.updated !== undefined && pending &&
        result.status.state !== 'idle' && result.status.updated >= pending.at + get().clockSkew
      const receiver = result.receiver ?? null
      const held = get().volumeHeld
      set({
        status: result.status,
        clockSkew: result.now - Date.now(),
        pending: reported || (pending && Date.now() - pending.at > PENDING_MS) ? null : pending,
        receiver,
        volumeHeld: held && receiver?.volume !== held.to && Date.now() - held.at <= VOLUME_HELD_MS ? held : null,
      })
    },

    async setVolume(to) {
      const level = Math.round(Math.max(0, Math.min(1, to)) * 100) / 100
      set({ volumeHeld: { to: level, at: Date.now() } })
      const ok = await sendBion({ type: 'volume', to: level })
      set(ok ? { failed: false } : { failed: true, volumeHeld: null })
    },

    playHome: (item, profileId, fromStart) =>
      start(item.name, { type: 'play', source: 'home', profileId, itemId: item.id, fromStart }),

    playIptv: (channel, profileId) =>
      start(channelTitle(channel), { type: 'play', source: 'iptv', profileId, itemId: channel.id }),

    async send(command) {
      // Shown at once; the next poll puts back whatever the kiosk actually did.
      const status = get().status
      if (status) {
        if (command.type === 'pause') set({ status: { ...status, state: 'paused' } })
        if (command.type === 'resume') set({ status: { ...status, state: 'playing' } })
        if (command.type === 'seek' && command.to !== undefined) set({ status: { ...status, position: command.to } })
        else if (command.type === 'seek' && status.position !== undefined) {
          set({ status: { ...status, position: Math.max(0, status.position + command.by) } })
        }
        if (command.type === 'audio') set({ status: { ...status, audioActive: command.id } })
        if (command.type === 'subtitle') set({ status: { ...status, subtitleActive: command.id } })
        if (command.type === 'stop') set({ status: { ...status, state: 'idle' }, pending: null })
      }
      const ok = await sendBion(command)
      set({ failed: !ok })
    },
  }
})

/** Whether something is on Bion, or about to be, by this device's clock. */
export function bionVisible(s: Pick<BionState, 'status' | 'clockSkew' | 'pending'>, now = Date.now()): boolean {
  if (s.pending && now - s.pending.at <= PENDING_MS) return true
  // A film the kiosk could not start stays on screen long enough to be read.
  const st = s.status
  if (st?.state === 'failed' && st.updated !== undefined && now + s.clockSkew - st.updated <= STATUS_FRESH_MS) return true
  return isBionActive(st, now + s.clockSkew)
}

/** The receiver's level to show: the one just sent, else what HA last wrote. Null while it is off. */
export function receiverVolume(s: Pick<BionState, 'receiver' | 'volumeHeld'>): number | null {
  if (s.receiver?.state !== 'on') return null
  return s.volumeHeld?.to ?? s.receiver.volume
}

/** Whether the kiosk has been heard from lately, idle or not. */
export function bionAlive(s: Pick<BionState, 'status' | 'clockSkew'>, now = Date.now()): boolean {
  return s.status?.updated !== undefined && now + s.clockSkew - s.status.updated <= ALIVE_MS
}

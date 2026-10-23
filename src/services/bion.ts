// Talking to the kiosks through /api/bion: Bion in the basement, and the TV in the
// living room. The phone sends commands and reads the status; a kiosk reads its
// commands and writes its status. See functions/api/bion.ts for why this is polling
// and not a socket.

import { fireAndForget } from '@/lib/fireAndForget'
import { redactStreamUrl, restoreStreamUrl, toPlaylistHost } from '@/lib/provider'
import { normalizeShowKey } from '@/lib/utils'
import type { Channel, ContentType } from '@/types'

const API = '/api/bion'

/**
 * The kiosks, by the name each one polls with. `bion` is the projector in the
 * basement; `vardagsrum` the TV upstairs, whose app Home Assistant opens when a Play
 * is sent to it.
 */
export const BION_DEVICES = ['bion', 'vardagsrum'] as const
export type BionDevice = (typeof BION_DEVICES)[number]

/** Where a film comes from: the home server's Jellyfin, or the IPTV playlist. */
export type BionSource = 'home' | 'iptv'

/**
 * An IPTV film or episode as a Play carries it: what a card knows, and the stream
 * address with `~` for the account's name and password, which the kiosk fills in
 * from its own playlist address. The queue is open, so nothing secret goes in.
 *
 * The kiosk used to look the id up in its own copy of the catalogue, 205 803 titles.
 * The TV in the living room needs about seven minutes to write that copy, and it
 * wrote it again for every film newer than the copy it had (2026-10-23).
 */
export interface BionChannel {
  id: string
  name: string
  url: string
  type: ContentType
  logo?: string
  groupTitle?: string
  tvgId?: string
  showName?: string
  season?: number
  episode?: number
  episodeTitle?: string
  year?: number
  movieTitle?: string
}

/** How many of a show's later episodes a Play brings, so the next one starts without the catalogue. */
export const MAX_BION_EPISODES = 60

const OPTIONAL_FIELDS = ['logo', 'groupTitle', 'tvgId', 'showName', 'season', 'episode', 'episodeTitle', 'year', 'movieTitle'] as const

/** A card's channel as a Play carries it. Null when its address does not carry this playlist's account. */
export function toBionChannel(c: Channel, m3uUrl: string | null | undefined): BionChannel | null {
  const url = redactStreamUrl(toPlaylistHost(c.url, m3uUrl), m3uUrl)
  if (!url) return null
  const out: BionChannel = { id: c.id, name: c.name, url, type: c.type }
  for (const key of OPTIONAL_FIELDS) {
    const v = c[key]
    if (v !== undefined && v !== '') (out as unknown as Record<string, unknown>)[key] = v
  }
  return out
}

/** Back to a channel on the kiosk. Null when this kiosk has no playlist address to fill in from. */
export function fromBionChannel(b: BionChannel, m3uUrl: string | null | undefined, sortIndex: number): Channel | null {
  const url = restoreStreamUrl(b.url, m3uUrl)
  if (!url) return null
  return { ...b, url, logo: b.logo ?? '', groupTitle: b.groupTitle ?? '', sortIndex }
}

/** The episodes of `c`'s show after it, in order, as many as a Play brings. */
export function laterEpisodes(c: Channel, channels: readonly Channel[]): Channel[] {
  if (c.type !== 'series') return []
  const show = normalizeShowKey(c.showName ?? c.name)
  const eps = channels
    .filter((x) => x.type === 'series' && normalizeShowKey(x.showName ?? x.name) === show)
    .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0))
  const i = eps.findIndex((x) => x.id === c.id)
  return i === -1 ? [] : eps.slice(i + 1, i + 1 + MAX_BION_EPISODES)
}

export type BionCommand =
  | {
      type: 'play'
      source?: BionSource
      profileId: string
      itemId: string
      fromStart?: boolean
      /** IPTV: the film itself, so the kiosk needs no catalogue. Older phones send only the id. */
      channel?: BionChannel
      /** IPTV series: the episodes after it, for the next one. */
      episodes?: BionChannel[]
    }
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
  /** The receiver's level, 0–1 as Home Assistant counts it (one step per dB). Goes to HA, not the kiosk. */
  | { type: 'volume'; to: number }

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
  /** The receiver as Home Assistant last wrote it. Missing before HA has written it at all. */
  receiver?: ReceiverStatus | null
}

/** Written by Home Assistant whenever the receiver is switched or its volume changes. */
export interface ReceiverStatus {
  /** HA's state: `on`, `off`, `unavailable`. */
  state: string
  /** 0–1, one step per dB: 0.45 is −55 dB. */
  volume: number
  muted: boolean
  updated?: number
}

export async function pollBion(device: BionDevice, after?: number): Promise<BionPoll | null> {
  const q = new URLSearchParams({ device })
  if (after !== undefined) q.set('after', String(after))
  try {
    const res = await fetch(`${API}?${q}`, { cache: 'no-store' })
    if (res.ok) return await res.json() as BionPoll
    // Read or cancelled, never left: the kiosk asks every two seconds, and an unread
    // body holds a file open (see lib/fireAndForget.ts).
    res.body?.cancel().catch(() => {})
    return null
  } catch {
    return null
  }
}

export async function sendBion(device: BionDevice, command: BionCommand): Promise<boolean> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, command }),
    })
    res.body?.cancel().catch(() => {})
    return res.ok
  } catch {
    return false
  }
}

export function putBionStatus(device: BionDevice, status: Omit<BionStatus, 'updated'>): void {
  fireAndForget(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, status }),
  })
}

/** How long a status counts as current. The kiosk writes every five seconds while a film is on. */
export const STATUS_FRESH_MS = 20_000

/** Whether the phone should show the remote: something is on, and the kiosk said so recently. */
export function isBionActive(status: BionStatus | null, now: number): boolean {
  if (!status || status.updated === undefined) return false
  if (now - status.updated > STATUS_FRESH_MS) return false
  return status.state === 'loading' || status.state === 'waiting' || status.state === 'playing' || status.state === 'paused'
}

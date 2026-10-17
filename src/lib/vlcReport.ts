// What a VLC handler on someone's computer reports, and what becomes of it.
//
// The handler (public/vlc-handler.{sh,ps1}) starts VLC with its web interface on
// 127.0.0.1, reads position, length and the playing URI every ten seconds, and
// posts them with the playlist link it was handed to /api/vlc-report. Everything
// that needs knowing lives here rather than in two shell scripts: which entry is
// playing, whose position it is, and whether it counts as finished.
//
// Imported by the Pages Function by relative path, like vlcPlaylist.ts, so it
// imports nothing outside src/lib and nothing that touches the DOM.
import { decodePlaylist, decodeReport, type PlaylistItem, type ReportTarget } from './vlcPlaylist'
import { isCompleted } from './progress'

export interface VlcStatus {
  /** The playlist link the handler gave VLC: carries the entries (d) and the target (r). */
  src: string
  time: number
  length: number
  state: string
  /** The URI VLC says is current, from its playlist. */
  uri?: string
  /** First report of this VLC session. */
  first?: boolean
  /** VLC has closed; this is the last thing it was seen to do. */
  final?: boolean
}

export interface ParsedReport {
  items: PlaylistItem[]
  target: ReportTarget
}

/** The entries and target inside a playlist link, or null if it is not one of ours. */
export function parseSrc(src: string, origin: string): ParsedReport | null {
  try {
    const url = new URL(src)
    if (url.origin !== origin || !url.pathname.startsWith('/api/playlist/')) return null
    const d = url.searchParams.get('d')
    const r = url.searchParams.get('r')
    if (!d || !r) return null
    return { items: decodePlaylist(d), target: decodeReport(r) }
  } catch {
    return null
  }
}

function same(a: string, b: string): boolean {
  if (a === b) return true
  try { return decodeURIComponent(a) === decodeURIComponent(b) } catch { return false }
}

/**
 * The entry VLC is playing: by URI, or the only one there is. The Mac handler
 * cuts the URI out of VLC's JSON by hand, so JSON escapes may still be in it
 * ("&" for "&"). A home film's parts differ only by the id in their path.
 */
export function currentEntry(items: readonly PlaylistItem[], uri: string | undefined): PlaylistItem | null {
  if (uri) {
    const clean = uri.trim()
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\\//g, '/')
    const hit = items.find((i) => same(i.url, clean))
      ?? items.find((i) => i.id && /\/Videos\//.test(i.url) && clean.includes(`/Videos/${i.id}/`))
    if (hit) return hit
  }
  return items.length === 1 ? items[0] : null
}

/** What a report is worth saving: a position past the first ten seconds, of a known length. */
function meaningful(s: VlcStatus): boolean {
  return Number.isFinite(s.time) && Number.isFinite(s.length) && s.length > 0 && s.time > 10
}

/** The watch_progress row a StreamForest report writes, or null when there is nothing to say. */
export function progressRow(target: Extract<ReportTarget, { k: 'sf' }>, item: PlaylistItem, s: VlcStatus, now: number) {
  if (!item.id || !meaningful(s)) return null
  return {
    profileId: target.p,
    channelId: item.id,
    position: s.time,
    duration: s.length,
    lastWatched: now,
    // VLC reports every ten seconds, so the last report before an episode ends
    // can be that far from its end; ninety per cent is the rule everywhere else.
    completed: isCompleted(s.time, s.length),
  }
}

const TICKS = 10_000_000

/**
 * What the handler should send to Jellyfin for a report, as the three lines it
 * relays: path, Authorization, body. Jellyfin saves the position from progress
 * reports, and on "stopped" marks the item watched when it is near the end, which
 * is how a split film's parts get ticked off one by one.
 */
export function jellyfinRelay(target: Extract<ReportTarget, { k: 'jf' }>, item: PlaylistItem, s: VlcStatus): { path: string; auth: string; body: string } | null {
  if (!item.id || !meaningful(s)) return null
  const path = s.final ? '/Sessions/Playing/Stopped' : s.first ? '/Sessions/Playing' : '/Sessions/Playing/Progress'
  return {
    path,
    auth: `MediaBrowser Client="StreamForest", Device="VLC", DeviceId="sf-vlc", Version="1.0", Token="${target.t}"`,
    body: JSON.stringify({
      ItemId: item.id,
      PositionTicks: Math.round(s.time * TICKS),
      IsPaused: s.state === 'paused',
      CanSeek: true,
      PlayMethod: 'DirectPlay',
    }),
  }
}

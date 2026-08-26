// Opens content in VLC instead of the in-browser player. A secondary escape
// hatch for when transcode/subtitle playback misbehaves: VLC plays the *raw*
// provider stream directly (MPEG-TS, MKV, AC3/DTS, embedded subs) with no proxy.
//
// Platform strategy:
//   • iOS / Android — VLC registers the documented x-callback URL scheme.
//     A `vlc-x-callback://x-callback-url/stream?url=…` link opens VLC in one tap.
//   • macOS / Windows — desktop VLC registers NO url scheme by default. After a
//     one-time install of the `vlc://` handler — Settings → VLC hands out the
//     command, public/vlc-handler.{sh,ps1} is what it runs — the link opens VLC
//     directly. If no handler is registered, we detect that the page never lost
//     focus and fall back to downloading a `.m3u` playlist (VLC's default file
//     association) for the user to open manually.
//
// A whole season goes over the same two links. Neither scheme takes more than
// one URL, so the link points at `/api/playlist/<name>.m3u?d=…` — an endpoint
// that reconstructs the playlist from the token and serves it. VLC opens the
// remote .m3u as a playlist and plays the season in order.
import type { Channel } from '@/types'
import { buildM3u, encodePlaylist, type PlaylistItem } from './vlcPlaylist'

const IS_IOS = typeof navigator !== 'undefined' && (
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
)
const IS_ANDROID = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)
const IS_MOBILE = IS_IOS || IS_ANDROID

export type VlcPlatform = 'ios' | 'android' | 'macos' | 'windows' | 'other'

/** Which of the two handover routes this device is on — Settings asks, to know
 *  whether there is anything to install here and which installer to offer. */
export function vlcPlatform(): VlcPlatform {
  if (IS_IOS) return 'ios'
  if (IS_ANDROID) return 'android'
  if (typeof navigator === 'undefined') return 'other'
  if (/Mac/.test(navigator.userAgent)) return 'macos'
  if (/Win/.test(navigator.userAgent)) return 'windows'
  return 'other'
}

// The token carries the season's URLs, so the link grows with the season. Past
// this we stop trying to deeplink and hand over the file instead: proxies and
// servers start truncating long request lines well before the browser does, and
// a silently cut token would reach VLC as a broken playlist.
const MAX_DEEPLINK_URL = 6000

// Human-friendly label for the playlist entry / VLC "now playing".
export function vlcTitle(channel: Channel): string {
  if (channel.type === 'series') {
    const se = channel.season != null && channel.episode != null
      ? ` S${String(channel.season).padStart(2, '0')}E${String(channel.episode).padStart(2, '0')}`
      : ''
    return `${channel.showName ?? channel.name}${se}${channel.episodeTitle ? ` · ${channel.episodeTitle}` : ''}`
  }
  if (channel.type === 'movie') {
    return `${channel.movieTitle ?? channel.name}${channel.year ? ` (${channel.year})` : ''}`
  }
  return channel.name
}

// vlc-x-callback://x-callback-url/stream?url=<encoded>&x-success=<encoded return url>
// `stream` is the only path that takes a remote url; plain `vlc://` just rewrites
// the scheme to http, which would break https sources.
function xCallbackLink(streamUrl: string): string {
  const params = new URLSearchParams({ url: streamUrl })
  if (typeof location !== 'undefined') params.set('x-success', location.href)
  return `vlc-x-callback://x-callback-url/stream?${params.toString()}`
}

function fileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'stream'
}

/** The `/api/playlist` link VLC can fetch, or null if it came out too long. */
function playlistUrl(items: PlaylistItem[], name: string): string | null {
  // The `.m3u` extension is load-bearing: it is how VLC decides it was handed a
  // playlist rather than a stream, before any Content-Type is looked at.
  const url = `${location.origin}/api/playlist/${encodeURIComponent(fileName(name))}.m3u`
    + `?d=${encodePlaylist(items)}`
  return url.length > MAX_DEEPLINK_URL ? null : url
}

// The M3U the OS will hand to VLC (its default .m3u handler).
function downloadM3u(items: PlaylistItem[], name: string): void {
  const blob = new Blob([buildM3u(items)], { type: 'audio/x-mpegurl' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = `${fileName(name)}.m3u`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has been handed off to the browser's download flow.
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

// How long a click waits for VLC before giving up and downloading the file.
const FALLBACK_MS = 1200
// How long we keep watching before *recording* an answer. A cold VLC can take
// several seconds to come up, and a verdict this computer then acts on for a
// week must not be decided in the first second and a bit.
const VERDICT_MS = 6000

const HANDLER_KEY = 'sf-vlc-handler'
const VERDICT_TTL = 7 * 24 * 60 * 60 * 1000

export type VlcHandler = 'installed' | 'missing' | 'unknown'

/** What this computer was last seen to do — Settings reports it, and a click
 *  skips the dead wait when the answer is already known to be no. */
export function vlcHandler(): VlcHandler {
  try {
    const raw = localStorage.getItem(HANDLER_KEY)
    if (!raw) return 'unknown'
    const { state, at } = JSON.parse(raw) as { state: string; at: number }
    // "Installed" cannot become wrong by itself. "Missing" can — the handler may
    // have been installed since — and nothing would ever try again, so it lapses.
    if (state === 'missing' && Date.now() - at > VERDICT_TTL) return 'unknown'
    return state === 'installed' || state === 'missing' ? state : 'unknown'
  } catch {
    return 'unknown'
  }
}

function rememberHandler(installed: boolean): void {
  try {
    localStorage.setItem(HANDLER_KEY, JSON.stringify({
      state: installed ? 'installed' : 'missing',
      at: Date.now(),
    }))
  } catch {
    // Private mode, or storage full. The wait comes back; nothing breaks.
  }
}

// Navigate to vlc://<url> and answer whether the OS switched away to VLC. With
// a handler registered the page loses focus; with none, nothing happens at all —
// which is the only signal a page gets, since an unhandled scheme throws nothing.
//
// The answer the caller acts on and the answer we record are taken at different
// times on purpose: the click cannot wait six seconds to start downloading, and
// the record cannot afford to call a slow-launching VLC missing.
function switchToVlc(target: string, decideMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let switched = false
    const onBlur = () => { switched = true }
    const onHide = () => { if (document.hidden) switched = true }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onHide)

    location.href = `vlc://${target}`

    window.setTimeout(() => resolve(switched), decideMs)
    window.setTimeout(() => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onHide)
      rememberHandler(switched)
    }, Math.max(decideMs, VERDICT_MS))
  })
}

// Desktop: try the handler, fall back to the .m3u file if it is not installed.
function openDesktop(target: string, fallback: () => void): void {
  // A computer already known to have no handler should not spend a second and a
  // bit failing at it on every single click — that pause is most of what makes
  // the download route feel broken rather than merely different.
  if (vlcHandler() === 'missing') {
    fallback()
    return
  }
  void switchToVlc(target, FALLBACK_MS).then((switched) => { if (!switched) fallback() })
}

/**
 * Settings → VLC's Test button. Opens VLC on a deliberately empty playlist and
 * reports whether the handler answered, so "is this computer set up?" has an
 * answer that does not involve starting a film to find out. Takes the full
 * verdict window, since its whole job is to be right.
 */
export function probeVlcHandler(): Promise<boolean> {
  return switchToVlc(`${location.origin}/vlc-test.m3u`, VERDICT_MS)
}

// `target` is what VLC should open — a stream URL for one item, the playlist
// endpoint for several. `items`/`name` are only for the download fallback.
function handOver(target: string, items: PlaylistItem[], name: string): void {
  if (IS_MOBILE) {
    location.href = xCallbackLink(target)
    return
  }
  openDesktop(target, () => downloadM3u(items, name))
}

/**
 * Open this channel/movie/episode in VLC.
 * Mobile uses a one-tap deeplink; desktop tries the vlc:// handler and falls
 * back to a .m3u download if none is installed.
 */
export function openInVlc(channel: Channel): void {
  const title = vlcTitle(channel)
  handOver(channel.url, [{ title, url: channel.url }], title)
}

/**
 * Open several items in VLC as one ordered playlist — a whole season, so it
 * plays on into the next episode instead of stopping after the first.
 */
export function openPlaylistInVlc(channels: Channel[], name: string): void {
  if (channels.length === 0) return
  if (channels.length === 1) {
    openInVlc(channels[0])
    return
  }
  const items = channels.map((c) => ({ title: vlcTitle(c), url: c.url }))
  const hosted = playlistUrl(items, name)
  // No link short enough to survive the trip: the file is the only route left,
  // and it carries the same playlist.
  if (!hosted) {
    downloadM3u(items, name)
    return
  }
  handOver(hosted, items, name)
}

// Opens content in VLC instead of the in-browser player. A secondary escape
// hatch for when transcode/subtitle playback misbehaves: VLC plays the *raw*
// provider stream directly (MPEG-TS, MKV, AC3/DTS, embedded subs) with no proxy.
//
// Platform strategy:
//   • iOS / Android — VLC registers the documented x-callback URL scheme.
//     A `vlc-x-callback://x-callback-url/stream?url=…` link opens VLC in one tap.
//   • macOS / Windows — desktop VLC registers NO url scheme by default. After a
//     one-time install of the `vlc://` handler (see tools/vlc-handler/), the link
//     opens VLC directly. If no handler is registered, we detect that the page
//     never lost focus and fall back to downloading a one-line `.m3u` playlist
//     (VLC's default file association) for the user to open manually.
import type { Channel } from '@/types'

const IS_IOS = typeof navigator !== 'undefined' && (
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
)
const IS_ANDROID = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)
const IS_MOBILE = IS_IOS || IS_ANDROID

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

// One-line M3U the OS will hand to VLC (its default .m3u handler).
function downloadM3u(channel: Channel): void {
  const body = `#EXTM3U\n#EXTINF:-1,${vlcTitle(channel)}\n${channel.url}\n`
  const blob = new Blob([body], { type: 'audio/x-mpegurl' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = `${vlcTitle(channel).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'stream'}.m3u`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has been handed off to the browser's download flow.
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

// Desktop: navigate to vlc://<stream-url>. If a handler is registered the OS
// switches to VLC (the page loses focus); if not, nothing happens, so after a
// short grace period with the page still focused we fall back to the .m3u file.
function openDesktop(channel: Channel): void {
  let switched = false
  const onBlur = () => { switched = true }
  const onHide = () => { if (document.hidden) switched = true }
  window.addEventListener('blur', onBlur, { once: true })
  document.addEventListener('visibilitychange', onHide)

  location.href = `vlc://${channel.url}`

  window.setTimeout(() => {
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onHide)
    if (!switched) downloadM3u(channel)
  }, 1200)
}

/**
 * Open this channel/movie/episode in VLC.
 * Mobile uses a one-tap deeplink; desktop tries the vlc:// handler and falls
 * back to a .m3u download if none is installed.
 */
export function openInVlc(channel: Channel): void {
  if (IS_MOBILE) {
    location.href = xCallbackLink(channel.url)
    return
  }
  openDesktop(channel)
}

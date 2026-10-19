/**
 * Whether to hand the playlist to the <video> itself rather than to hls.js.
 *
 * Only on Apple's engine, where it has to be: on an iPhone that is the system
 * player, with AirPlay. Chromium has started answering "maybe" as well (155 on
 * Linux, the kiosk, 2026-10-19), and then fails to parse Jellyfin's playlists
 * (DEMUXER_ERROR_COULD_NOT_PARSE): the film never starts. Everywhere else hls.js
 * plays it, as it did before Chromium answered.
 */
export function playsHlsItself(video: Pick<HTMLVideoElement, 'canPlayType'>, ua = navigator.userAgent): boolean {
  if (!video.canPlayType('application/vnd.apple.mpegurl')) return false
  const ios = /iPhone|iPad|iPod/.test(ua)
  const macSafari = /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua)
  return ios || macSafari
}

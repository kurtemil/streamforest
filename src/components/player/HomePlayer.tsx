import { useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import { X } from 'lucide-react'
import { getPlaybackSource, reportPlayback, type PlaybackSource } from '@/services/jellyfin'
import { useHomeLibraryStore } from '@/stores/homeLibraryStore'
import { useT } from '@/lib/i18n'

const REPORT_EVERY_MS = 10_000

/**
 * The player for the home library. Deliberately separate from VideoPlayer.
 *
 * VideoPlayer exists to make raw IPTV streams playable: probing, server-side seeking,
 * subtitle extraction, keyframe tricks, all through the transcode proxy. Jellyfin
 * already serves what a browser can play, as a file or as seekable HLS, so none of
 * that applies here and none of it should be at risk from this.
 *
 * The browser's own controls are used on purpose: on an iPhone that is the system
 * player, with AirPlay and picture-in-picture for free.
 */
export function HomePlayer() {
  const t = useT()
  const { playing, session, close, reload } = useHomeLibraryStore()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!playing || !session || !video) return
    setFailed(false)
    let cancelled = false
    let hls: Hls | null = null
    let source: PlaybackSource | null = null
    let started = false
    // Resume where this profile left off, here or in Swiftfin, unless it was finished.
    const resumeAt = !playing.played && playing.positionSec > 10 ? playing.positionSec : 0

    ;(async () => {
      try {
        source = await getPlaybackSource(session, playing)
        if (cancelled) return
        if (source.hls && !video.canPlayType('application/vnd.apple.mpegurl')) {
          const HlsLib = (await import('hls.js')).default
          if (cancelled) return
          if (!HlsLib.isSupported()) throw new Error('no MSE')
          hls = new HlsLib({ startPosition: resumeAt > 0 ? resumeAt : -1 })
          hls.on(HlsLib.Events.ERROR, (_e, data) => { if (data.fatal) setFailed(true) })
          hls.loadSource(source.url)
          hls.attachMedia(video)
        } else {
          video.src = source.url
          if (resumeAt > 0) {
            video.addEventListener('loadedmetadata', () => { video.currentTime = resumeAt }, { once: true })
          }
        }
        // May be refused outside the tap that opened the player (iOS). The controls
        // then show a play button, which is the right fallback.
        video.play().catch(() => {})
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()

    const onPlaying = () => {
      if (!source) return
      if (!started) { started = true; void reportPlayback(session, source, 'start', video.currentTime) }
    }
    const onPause = () => { if (source && started) void reportPlayback(session, source, 'progress', video.currentTime, true) }
    const onEnded = () => { if (source && started) void reportPlayback(session, source, 'stopped', video.currentTime) }
    video.addEventListener('playing', onPlaying)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    const timer = window.setInterval(() => {
      if (source && started && !video.paused) void reportPlayback(session, source, 'progress', video.currentTime)
    }, REPORT_EVERY_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      // Stopped is what makes the server save the position and end the transcode.
      // Read the list again once it has, so the card shows where this left off.
      if (source && started) {
        void reportPlayback(session, source, 'stopped', video.currentTime).then(() => reload())
      }
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [playing, session, reload])

  useEffect(() => {
    if (!playing) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, close])

  if (!playing) return null

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 pt-safe px-safe">
        <button
          onClick={close}
          aria-label={t('common.close')}
          className="m-3 w-10 h-10 rounded-full bg-black/60 ring-1 ring-white/20 flex items-center justify-center text-white"
        >
          <X size={18} />
        </button>
        <p className="text-body text-white/90 font-medium truncate">{playing.name}</p>
      </div>
      <video
        ref={videoRef}
        controls
        playsInline
        autoPlay
        className="w-full h-full object-contain bg-black"
      />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="text-body text-white/80 bg-black/70 rounded-lg px-4 py-3">{t('home.playFailed')}</p>
        </div>
      )}
    </div>
  )
}

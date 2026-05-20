import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import type Hls from 'hls.js'
import { Play, Pause, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { usePlaylistStore } from '@/stores/playlistStore'
import { saveProgress, getProgress, clearProgress } from '@/services/db'
import { pushProgress, deleteRemoteProgress } from '@/services/sync'
import { useProfileStore } from '@/stores/profileStore'
import { usePlaybackPrefsStore } from '@/stores/playbackPrefsStore'
import {
  isTranscodeProxyConfigured, transcodeUrl, liveStreamUrl, probeMedia, pickProxyMode,
  subtitleVttUrl, audioStreamLabel, subtitleStreamLabel, getKeyframeTime, logDiagnostic,
  startHlsSession, getLastHlsError,
} from '@/lib/transcode'
import type { ProxyMode } from '@/lib/transcode'
import { normalizeShowKey } from '@/lib/utils'
import { parseVttBlock } from '@/lib/vtt'
import { PlayerControls } from './PlayerControls'

const SAVE_INTERVAL_MS = 5000
const VIDEO_EXT = /\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i

// iOS WebKit can't stream fMP4 via video.src without Content-Length / range
// request support. We use the MediaSource API instead: fetch() streams the
// proxy response and SourceBuffer.appendBuffer() feeds it chunk by chunk.
const IS_IOS = typeof navigator !== 'undefined' && (
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
)
// iOS 17 introduced MSE as ManagedMediaSource; iOS 26 dropped the MediaSource alias.
// Prefer ManagedMediaSource (requires disableRemotePlayback on the video element).
const MediaSourceCtor: (typeof MediaSource) | undefined = (() => {
  if (typeof window === 'undefined') return undefined
  if ('ManagedMediaSource' in window) return (window as unknown as { ManagedMediaSource: typeof MediaSource }).ManagedMediaSource
  if (typeof MediaSource !== 'undefined') return MediaSource
  return undefined
})()
// Bare 'video/mp4' lets the browser infer codec from the stream — handles H264/HEVC/AV1.
const MSE_MIME_CANDIDATES = [
  'video/mp4',
  'video/mp4; codecs="avc1.640033,mp4a.40.2"',
  'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
  'video/mp4; codecs="hvc1.1.6.L120.90,mp4a.40.2"',
  'video/mp4; codecs="hev1.1.6.L120.90,mp4a.40.2"',
]
function pickMseMime(): string | null {
  if (!MediaSourceCtor) return null
  return MSE_MIME_CANDIDATES.find(m => MediaSourceCtor.isTypeSupported(m)) ?? null
}
function getMseDiag(): string {
  const ios = IS_IOS ? 'ios' : 'desktop'
  const api = !MediaSourceCtor ? 'undef' : ('ManagedMediaSource' in window ? 'MMS' : 'MS')
  if (!MediaSourceCtor) return `[${ios} MSE:${api}]`
  const pairs = MSE_MIME_CANDIDATES.map((m) => {
    const label = m === 'video/mp4' ? 'bare' : m.includes('hvc1') ? 'hvc1' : m.includes('hev1') ? 'hev1' : 'avc1'
    return `${label}:${MediaSourceCtor.isTypeSupported(m) ? 'Y' : 'N'}`
  })
  return `[${ios} ${api} ${pairs.join(' ')}]`
}

interface Track { id: number; name: string; lang: string }

function isProxyVideo(channel: { type: string; url: string } | null): boolean {
  if (!channel || !isTranscodeProxyConfigured()) return false
  return channel.type === 'movie' || channel.type === 'series' || VIDEO_EXT.test(channel.url)
}


type VideoWithAudioTracks = HTMLVideoElement & {
  audioTracks?: EventTarget & {
    readonly length: number
    [index: number]: { id: string; kind: string; label: string; language: string; enabled: boolean }
    addEventListener(type: string, handler: EventListener): void
    removeEventListener(type: string, handler: EventListener): void
  }
}

export function VideoPlayer() {
  const navigate = useNavigate()
  const { current, play, close } = usePlayerStore()
  const { channels } = usePlaylistStore()
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const rawPlaybackPrefs = usePlaybackPrefsStore((s) => s.byProfile[activeProfileId ?? ''])
  const autoplayNextEpisode = rawPlaybackPrefs?.autoplayNextEpisode ?? true
  const preferredSubtitleLang = rawPlaybackPrefs?.preferredSubtitleLang ?? ''
  const preferredAudioLang = rawPlaybackPrefs?.preferredAudioLang ?? ''
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const mseAbortRef = useRef<AbortController | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Baseline seconds baked into the source URL (for transcode-proxy resume).
  // Real playback time = playbackOffsetRef.current + video.currentTime.
  const playbackOffsetRef = useRef(0)
  const isTranscodedRef = useRef(false)
  const transcodedDurationRef = useRef<number | null>(null)
  // For probe-derived MKV tracks: which audio stream index ffmpeg is currently
  // mapping. Re-included whenever we rebuild the transcode URL (seek/audio swap).
  const audioStreamIndexRef = useRef<number | null>(null)
  // Proxy mode for the current source: 'copy' (cheap remux, browser-compatible
  // codecs) or 'transcode' (full re-encode for AC3/DTS/etc.). Re-applied when
  // the URL is rebuilt for seek or audio swap.
  const proxyModeRef = useRef<ProxyMode | null>(null)
  // format-level start_time from probe — used to normalise subtitle VTT timestamps
  // so they align with the re-based (0-origin) video timeline.
  const videoStartTimeRef = useRef(0)
  // Tracks the active VTT subtitle so we can re-attach after a src reload
  // (audio swap rebuilds video.src, which clears any addTextTrack-created list).
  const activeSubtitleRef = useRef(-1)
  const subtitleAbortRef = useRef<AbortController | null>(null)
  // Stall threshold: abort only if NO bytes from the proxy for this long.
  // The proxy sends VTT NOTE keepalives every ~20 s during silent stretches so
  // this should only fire on genuine proxy failure, not subtitle gaps.
  const SUBTITLE_STALL_MS = 300_000
  const [isBuffering, setIsBuffering] = useState(true)
  const [showControls, setShowControls] = useState(true)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audioTracks, setAudioTracks] = useState<Track[]>([])
  const [activeAudioTrack, setActiveAudioTrack] = useState(-1)
  const [subtitleTracks, setSubtitleTracks] = useState<Track[]>([])
  const [activeSubtitle, setActiveSubtitle] = useState(-1)
  const [loadingSubtitle, setLoadingSubtitle] = useState<number | null>(null)
  const [subtitleNotice, setSubtitleNotice] = useState<string | null>(null)
  const subtitleNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const playbackSpeedRef = useRef(1)
  const [nextEpCountdown, setNextEpCountdown] = useState<number | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const nextEpisodeRef = useRef<typeof current>(null)
  const autoplayRef = useRef(true)
  const autoAudioSelectedRef = useRef(false)
  const subtitleTracksRef = useRef<Track[]>([])
  const subtitleStreamIndicesRef = useRef<number[]>([])
  const [parsedSubtitles, setParsedSubtitles] = useState<{ start: number; end: number; text: string }[]>([])
  const [subtitleDelay, setSubtitleDelay] = useState(0)
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right' } | null>(null)
  const [seekFeedback, setSeekFeedback] = useState<{ side: 'left' | 'right'; key: number } | null>(null)

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
  }, [])

  // Tracks the iOS playback strategy for the current item so the error handler
  // can fall back from HLS → MSE when the HLS proxy fails (e.g. provider 404).
  const iosStrategyRef = useRef<'hls' | 'hls-gen' | 'mse' | null>(null)
  const iosFallbackUrlRef = useRef<string | null>(null)
  const iosHlsRetriedRef = useRef(false)
  // Short event codes appended as MSE pipeline runs — shown in the error message
  // so we can diagnose without needing server logs or USB cable.
  const mseDiagLogRef = useRef<string[]>([])

  // Pipe a proxy fMP4 stream via MSE instead of setting video.src directly.
  // iOS WebKit won't stream fMP4 from video.src without Content-Length/range support,
  // but fetch() + SourceBuffer works on iOS 17+ where MSE is fully supported.
  // Returns false if MSE is unavailable so the caller can fall back to video.src.
  const startMsePlayback = useCallback((video: HTMLVideoElement, url: string): boolean => {
    mseAbortRef.current?.abort()
    mseAbortRef.current = null
    const mime = pickMseMime()
    const dl = mseDiagLogRef.current
    dl.length = 0
    logDiagnostic('mse-start', { mseAvail: !!MediaSourceCtor, mime, diag: getMseDiag(), url: url.slice(-40) })
    if (!mime || !MediaSourceCtor) { dl.push('NO_MSE'); return false }
    const isMMS = typeof window !== 'undefined' && 'ManagedMediaSource' in window
    let ms: MediaSource
    try {
      ms = new MediaSourceCtor()
      dl.push('CR')
    } catch (e) {
      logDiagnostic('mse-ctor-failed', { err: String(e) })
      dl.push('CR_ERR')
      return false
    }
    logDiagnostic('mse-created', { isMMS, msState: ms.readyState })
    const abort = new AbortController()
    mseAbortRef.current = abort

    ms.addEventListener('sourceopen', async () => {
      dl.push('SO')
      logDiagnostic('mse-sourceopen', { msState: ms.readyState })
      let sb: SourceBuffer
      try {
        sb = ms.addSourceBuffer(mime)
        dl.push('SB')
        logDiagnostic('mse-sb-ok', { mime })
      } catch (e) {
        dl.push('SB_ERR')
        logDiagnostic('mse-sb-failed', { mime, err: String(e) })
        if (ms.readyState === 'open') ms.endOfStream('network')
        return
      }
      const drain = () => sb.updating
        ? new Promise<void>(r => sb.addEventListener('updateend', () => r(), { once: true }))
        : Promise.resolve()
      try {
        dl.push('FS')
        logDiagnostic('mse-fetch-start', { url: url.slice(-60) })
        const res = await fetch(url, { signal: abort.signal })
        dl.push(`F${res.status}`)
        logDiagnostic('mse-fetch-response', { status: res.status, ok: res.ok, hasBody: !!res.body })
        if (!res.ok || !res.body) {
          if (ms.readyState === 'open') ms.endOfStream('network')
          return
        }
        const reader = res.body.getReader()
        let chunkCount = 0
        let playTriggered = false
        while (true) {
          const { done, value } = await reader.read()
          if (done) { if (ms.readyState === 'open') ms.endOfStream(); break }
          if (ms.readyState !== 'open') { dl.push('MX'); logDiagnostic('mse-ms-closed-mid-stream', { chunkCount }); break }
          await drain()
          if (ms.readyState !== 'open') break
          try {
            sb.appendBuffer(value)
            chunkCount++
            if (chunkCount === 1) { dl.push('FC'); logDiagnostic('mse-first-chunk', { size: value.byteLength, msState: ms.readyState }) }
            if (!isMMS && !playTriggered) {
              playTriggered = true
              dl.push('PL')
              video.play()
                .then(() => { dl.push('PO'); logDiagnostic('mse-play-ok', {}) })
                .catch((e) => { dl.push('PR'); logDiagnostic('mse-play-rejected', { err: String(e) }) })
            }
          } catch (e) {
            dl.push('AB_ERR')
            logDiagnostic('mse-append-failed', { mime, err: String(e), chunkCount })
            if (ms.readyState === 'open') ms.endOfStream('decode')
            break
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          dl.push('SE')
          logDiagnostic('mse-stream-error', { err: String(e) })
          if (ms.readyState === 'open') ms.endOfStream('network')
        }
      }
    }, { once: true })

    ms.addEventListener('sourceended', () => { dl.push('END'); logDiagnostic('mse-sourceended', {}) })
    ms.addEventListener('sourceclose', () => { dl.push('CLOSE'); logDiagnostic('mse-sourceclose', {}) })

    // ManagedMediaSource: assign srcObject directly so iOS manages the streaming
    // lifecycle without needing a blob URL. Then call play() immediately — per
    // Apple's docs, play() triggers sourceopen on MMS (not the src assignment).
    // Regular MediaSource: use createObjectURL; play() happens after first chunk.
    if (isMMS) {
      dl.push('SRC_OBJ')
      ;(video as HTMLVideoElement & { srcObject: MediaSource | null }).srcObject = ms
      dl.push('PL')
      video.play()
        .then(() => { dl.push('PO'); logDiagnostic('mse-play-ok', {}) })
        .catch((e) => { dl.push('PR'); logDiagnostic('mse-play-rejected', { err: String(e) }) })
    } else {
      const objUrl = URL.createObjectURL(ms)
      ms.addEventListener('sourceopen', () => URL.revokeObjectURL(objUrl), { once: true })
      dl.push('SRC_URL')
      video.src = objUrl
    }
    return true
  }, [])

  const nextEpisode = useMemo(() => {
    if (!current || current.type !== 'series') return null
    const showKey = normalizeShowKey(current.showName ?? current.name)
    const showEps = channels
      .filter(c => c.type === 'series' && normalizeShowKey(c.showName ?? c.name) === showKey)
      .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0))
    const idx = showEps.findIndex(c => c.id === current.id)
    return idx !== -1 && idx < showEps.length - 1 ? showEps[idx + 1] : null
  }, [current, channels])

  useEffect(() => { nextEpisodeRef.current = nextEpisode }, [nextEpisode])
  useEffect(() => { autoplayRef.current = autoplayNextEpisode }, [autoplayNextEpisode])
  useEffect(() => { subtitleTracksRef.current = subtitleTracks }, [subtitleTracks])

  // Re-apply playback speed after every source load (browser resets to 1× on src change)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onMeta = () => { video.playbackRate = playbackSpeedRef.current }
    video.addEventListener('loadedmetadata', onMeta)
    return () => video.removeEventListener('loadedmetadata', onMeta)
  }, [])

  // Reset all per-item UI state on new item
  useEffect(() => {
    setMinimized(false)
    setSubtitleDelay(0)
    setIsBuffering(true)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    countdownIntervalRef.current = null
    setNextEpCountdown(null)
    autoAudioSelectedRef.current = false
    subtitleStreamIndicesRef.current = []
    iosStrategyRef.current = null
    iosFallbackUrlRef.current = null
    iosHlsRetriedRef.current = false
    mseDiagLogRef.current = []
  }, [current?.id])

  const resetControlsTimer = useCallback(() => {
    setShowControls(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3500)
  }, [])

  const clearCountdown = useCallback(() => {
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    countdownIntervalRef.current = null
    setNextEpCountdown(null)
  }, [])

  const activeCue = useMemo(() => {
    if (!parsedSubtitles.length) return null
    const searchTime = currentTime + subtitleDelay
    return parsedSubtitles.find(c => c.start <= searchTime && c.end > searchTime) ?? null
  }, [currentTime, parsedSubtitles, subtitleDelay])

  const handleSubtitleDelayChange = useCallback((delta: number) => {
    setSubtitleDelay(prev => parseFloat(Math.max(-10, Math.min(10, prev + delta)).toFixed(1)))
  }, [])

  useEffect(() => {
    if (!seekFeedback) return
    const t = setTimeout(() => setSeekFeedback(null), 700)
    return () => clearTimeout(t)
  }, [seekFeedback])

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (minimized) return
    const touch = e.changedTouches[0]
    if (!touch) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const side: 'left' | 'right' = touch.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
    const now = Date.now()
    const last = lastTapRef.current
    if (last?.side === side && now - last.time < 300) {
      e.preventDefault()
      lastTapRef.current = null
      const v = videoRef.current
      if (v) {
        const dur = Number.isFinite(v.duration) ? v.duration : Infinity
        v.currentTime = side === 'left'
          ? Math.max(0, v.currentTime - 10)
          : Math.min(v.currentTime + 10, dur)
      }
      setSeekFeedback({ side, key: now })
    } else {
      lastTapRef.current = { time: now, side }
    }
  }, [minimized])

  const handleSpeedChange = useCallback((s: number) => {
    playbackSpeedRef.current = s
    setPlaybackSpeed(s)
    if (videoRef.current) videoRef.current.playbackRate = s
  }, [])

  const handlePiP = useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => {})
    } else {
      await video.requestPictureInPicture().catch(() => {})
    }
  }, [])

  const handleClose = useCallback(() => {
    const video = videoRef.current
    if (current && current.type !== 'live' && video && video.currentTime > 0) {
      const profileId = useProfileStore.getState().activeProfileId
      if (profileId) {
        const realTime = playbackOffsetRef.current + video.currentTime
        const dur = transcodedDurationRef.current ?? (Number.isFinite(video.duration) ? video.duration : 0)
        saveProgress(profileId, current.id, realTime, dur)
          .then((entry) => pushProgress(entry))
      }
    }
    // Live channels don't push a route when opened, so navigate(-1) would leave /live
    if (current?.type !== 'live') navigate(-1)
    close()
  }, [navigate, close, current])

  const flashSubtitleNotice = useCallback((msg: string) => {
    if (subtitleNoticeTimerRef.current) clearTimeout(subtitleNoticeTimerRef.current)
    setSubtitleNotice(msg)
    subtitleNoticeTimerRef.current = setTimeout(() => setSubtitleNotice(null), 4500)
  }, [])

  const detachSubtitleTrack = useCallback(() => {
    subtitleAbortRef.current?.abort()
    subtitleAbortRef.current = null
    setParsedSubtitles([])
  }, [])

  // Custom subtitle renderer: parse VTT into a state array of {start,end,text} with
  // absolute file timestamps. activeCue is computed from currentTime+subtitleDelay
  // so no re-fetch or timestamp adjustment is ever needed after a seek.
  const attachSubtitleTrack = useCallback(async (streamIndex: number, _label: string, _lang: string, startSeconds?: number) => {
    if (!current) return
    const url = subtitleVttUrl(current.url, streamIndex, videoStartTimeRef.current, startSeconds ?? playbackOffsetRef.current)
    console.log('[subtitle] attach streamIndex=%d startSeconds=%s url=%s', streamIndex, startSeconds ?? playbackOffsetRef.current, url)
    if (!url) return
    detachSubtitleTrack()
    const ctrl = new AbortController()
    subtitleAbortRef.current = ctrl
    setLoadingSubtitle(streamIndex)

    let lastByteAt = Date.now()
    let stalled = false
    const stallTimer = setInterval(() => {
      if (Date.now() - lastByteAt > SUBTITLE_STALL_MS) {
        stalled = true
        ctrl.abort()
      }
    }, 2000)

    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`Proxy ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`)
      }
      if (!res.body) throw new Error('Subtitle response had no body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let cueCount = 0
      let gotFirst = false
      const pending: { start: number; end: number; text: string }[] = []

      const flush = (final: boolean) => {
        let idx
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const cue = parseVttBlock(block)
          if (cue) {
            pending.push({ start: cue.startTime, end: cue.endTime, text: cue.text })
            cueCount++
          }
        }
        if (final && buffer.length > 0) {
          const cue = parseVttBlock(buffer)
          if (cue) { pending.push({ start: cue.startTime, end: cue.endTime, text: cue.text }); cueCount++ }
          buffer = ''
        }
        if ((!gotFirst && pending.length >= 1) || (gotFirst && pending.length >= 20) || (final && pending.length > 0)) {
          const batch = pending.splice(0)
          if (!gotFirst) {
            gotFirst = true
            setLoadingSubtitle((cur) => (cur === streamIndex ? null : cur))
          }
          setParsedSubtitles(prev => [...prev, ...batch])
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) { buffer += decoder.decode(); flush(true); break }
        lastByteAt = Date.now()
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
        flush(false)
      }

      if (cueCount === 0) throw new Error('Subtitle stream had no readable cues')
    } catch (err) {
      const aborted = (err as { name?: string }).name === 'AbortError'
      if (aborted && !stalled) return
      const msg = stalled
        ? 'Subtitle extraction stalled — no data from proxy in 5 min'
        : (err instanceof Error ? err.message : 'Subtitle load failed')
      console.warn('[subtitle] attach failed:', err)
      flashSubtitleNotice(msg)
      activeSubtitleRef.current = -1
      setActiveSubtitle(-1)
    } finally {
      clearInterval(stallTimer)
      setLoadingSubtitle((cur) => (cur === streamIndex ? null : cur))
    }
  }, [current, detachSubtitleTrack, flashSubtitleNotice])

  const seekTo = useCallback((realTime: number) => {
    const video = videoRef.current
    if (!video || !current) return
    const clamped = Math.max(0, realTime)
    if (!isTranscodedRef.current) {
      video.currentTime = clamped
      return
    }
    // Transcoded stream: local time = real − baked-in offset.
    // If within the buffered window, a native seek works; otherwise rebuild
    // the source URL at the new start so ffmpeg restarts from there.
    const offset = playbackOffsetRef.current
    const localTime = clamped - offset
    const buf = video.buffered
    let inBuffered = false
    for (let i = 0; i < buf.length; i++) {
      if (localTime >= buf.start(i) && localTime <= buf.end(i)) {
        inBuffered = true
        break
      }
    }
    if (localTime >= 0 && inBuffered) {
      video.currentTime = localTime
      return
    }
    playbackOffsetRef.current = clamped
    setCurrentTime(clamped)
    setBuffered(clamped)
    // Clear any next-episode countdown — we seeked away from the end
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    countdownIntervalRef.current = null
    setNextEpCountdown(null)
    const seekUrl = transcodeUrl(current.url, {
      startSeconds: clamped,
      audioIndex: audioStreamIndexRef.current,
      mode: proxyModeRef.current ?? undefined,
      subtitleIndices: subtitleStreamIndicesRef.current,
      vstart: videoStartTimeRef.current || undefined,
    })
    if (IS_IOS) {
      const capturedCurrent = current
      startHlsSession(current.url, {
        mode: proxyModeRef.current ?? 'copy',
        audioIndex: audioStreamIndexRef.current,
        startSeconds: clamped,
      }).then((hlsUrl) => {
        if (usePlayerStore.getState().current !== capturedCurrent || !videoRef.current) return
        if (!hlsUrl) { setError(`iOS: HLS seek failed: ${getLastHlsError() || 'unknown'}`); setIsBuffering(false); return }
        videoRef.current.src = hlsUrl
        videoRef.current.play().catch(() => {})
      })
    } else {
      video.src = seekUrl
      video.play().catch(() => {})
    }
    console.log('[seekTo] src rebuilt at', clamped, '— activeSubtitle:', activeSubtitleRef.current, 'tracks:', subtitleTracksRef.current.length)
    if (proxyModeRef.current === 'copy') {
      // Copy mode: ffmpeg snaps to the nearest keyframe K ≤ clamped.
      // Correct playbackOffset to K async so subtitle timestamps stay aligned.
      const seekTarget = clamped
      getKeyframeTime(current.url, Math.floor(clamped))
        .then(keyframe => {
          if (playbackOffsetRef.current !== seekTarget) return // superseded by another seek
          playbackOffsetRef.current = keyframe
          if (activeSubtitleRef.current >= 0) {
            const track = subtitleTracksRef.current.find(t => t.id === activeSubtitleRef.current)
            if (track) attachSubtitleTrack(track.id, track.name, track.lang, seekTarget)
          }
        })
        .catch(() => {
          if (activeSubtitleRef.current >= 0) {
            const track = subtitleTracksRef.current.find(t => t.id === activeSubtitleRef.current)
            if (track) attachSubtitleTrack(track.id, track.name, track.lang, clamped)
          }
        })
    } else if (activeSubtitleRef.current >= 0) {
      const track = subtitleTracksRef.current.find(t => t.id === activeSubtitleRef.current)
      if (track) attachSubtitleTrack(track.id, track.name, track.lang, clamped)
    }
  }, [current, attachSubtitleTrack])

  // Load source when current changes
  useEffect(() => {
      if (!current || !videoRef.current) return
    const video = videoRef.current
    setError(null)
    setDuration(0)
    setCurrentTime(0)
    setBuffered(0)
    destroyHls()
    mseAbortRef.current?.abort()
    mseAbortRef.current = null

    setAudioTracks([])
    setActiveAudioTrack(-1)
    setSubtitleTracks([])
    setActiveSubtitle(-1)
    activeSubtitleRef.current = -1
    audioStreamIndexRef.current = null
    proxyModeRef.current = null
    detachSubtitleTrack()

    const load = async () => {
      let msePlaying = false
      // Live channels (Xtream Codes MPEG-TS over HTTP). Browsers can't play
      // raw MPEG-TS, and on HTTPS pages the HTTP source is mixed-content
      // blocked anyway. Route through the transcode-proxy in copy mode (cheap
      // remux to fragmented MP4). Saved progress is irrelevant for live.
      if (current.type === 'live') {
        if (!isTranscodeProxyConfigured()) {
          setError('Live TV requires the transcode proxy. Set VITE_TRANSCODE_PROXY_URL.')
          return
        }
        isTranscodedRef.current = false
        playbackOffsetRef.current = 0
        transcodedDurationRef.current = null
        // iOS WebKit can't stream fMP4 via video.src without range-request support.
        // Use native HLS instead: proxy the provider's .m3u8 through our /live-hls
        // endpoint so mixed-content is avoided and segment URLs are rewritten.
        // Live TV is never probed, so source codec is unknown. Force transcode on iOS
        // to guarantee H264+AAC output regardless of what the provider sends.
        // VOD is probed first and pickProxyMode handles codec selection there.
        if (IS_IOS) {
          iosStrategyRef.current = 'hls-gen'
          const capturedCurrent = current
          startHlsSession(current.url, { live: true, mode: 'transcode' }).then((hlsUrl) => {
            if (usePlayerStore.getState().current !== capturedCurrent || !videoRef.current) return
            if (!hlsUrl) { setError(`iOS: HLS generation failed: ${getLastHlsError() || 'unknown'}`); setIsBuffering(false); return }
            videoRef.current.src = hlsUrl
            videoRef.current.play().catch(() => {})
          })
          return
        }
        const streamSrc = liveStreamUrl(current.url, 'copy')
        if (streamSrc) {
          video.src = streamSrc
          video.play().catch(() => {})
        }
        return
      }

      const profileId = useProfileStore.getState().activeProfileId
      const saved = profileId ? await getProgress(profileId, current.id) : undefined
      const startTime = saved && !saved.completed ? saved.position : 0
      // Replay of a finished item: drop the completed flag right now so the
      // "seen" check disappears immediately. Next save tick (5 s in) will
      // record fresh position/duration.
      if (saved?.completed && profileId) {
        clearProgress(profileId, current.id)
        deleteRemoteProgress(profileId, current.id)
      }

      const isVideoFile = current.type === 'movie' || current.type === 'series' || VIDEO_EXT.test(current.url)

      if (isVideoFile) {
        // Direct video file — default to native <video> playback.
        // Probe (a) to detect audio codecs Chrome can't decode (AC3/DTS), and
        // (b) to enumerate embedded audio/subtitle tracks. Browsers don't
        // expose embedded MKV tracks via the <video> element, so the picker
        // depends on probe + ffmpeg routing. Movie/series URLs from many
        // providers omit the .mkv extension, so we trust the channel type.
        // Start both fetches in parallel: probe for codec info, keyframe for
        // copy-mode offset correction. getKeyframeTime is cheap if start=0.
        const probeP = isProxyVideo(current) ? probeMedia(current.url) : Promise.resolve(null)
        const keyframeP = isProxyVideo(current) && startTime > 0
          ? getKeyframeTime(current.url, startTime)
          : Promise.resolve(startTime)

        const info = await probeP
        if (usePlayerStore.getState().current !== current) return // navigated away during probe

        if (info) {
          if (info.audioStreams.length > 1) {
            setAudioTracks(info.audioStreams.map(s => ({
              id: s.index,
              name: audioStreamLabel(s),
              lang: s.lang ?? '',
            })))
            const firstIdx = info.audioStreams[0].index
            audioStreamIndexRef.current = firstIdx
            setActiveAudioTrack(firstIdx)
          } else if (info.audioStreams.length === 1) {
            audioStreamIndexRef.current = info.audioStreams[0].index
          }
          if (info.subtitleStreams.length > 0) {
            subtitleStreamIndicesRef.current = info.subtitleStreams.map(s => s.index)
            setSubtitleTracks(info.subtitleStreams.map(s => ({
              id: s.index,
              name: subtitleStreamLabel(s),
              lang: s.lang ?? '',
            })))
          }
        }

        // Movie/series streams: always route through the proxy so the upstream
        // sees one persistent connection. Direct browser-to-provider playback
        // breaks down on seek because IPTV providers commonly rate-limit
        // concurrent Range requests (509 errors). Use 'copy' (cheap remux) when
        // codecs are browser-compatible, 'transcode' (re-encode) for AC3/DTS.
        if (isProxyVideo(current)) {
          const mode = pickProxyMode(info)
          proxyModeRef.current = mode
          isTranscodedRef.current = true
          videoStartTimeRef.current = info?.startTime ?? 0
          playbackOffsetRef.current = startTime
          // For copy mode, correct the offset to the actual keyframe K async so
          // video starts immediately (no extra wait on top of the probe).
          if (mode === 'copy' && startTime > 0) {
            const capturedCurrent = current
            keyframeP.then(keyframe => {
              if (usePlayerStore.getState().current === capturedCurrent) {
                playbackOffsetRef.current = keyframe
              }
            }).catch(() => {})
          }
          transcodedDurationRef.current = info?.duration ?? null
          if (info?.duration) setDuration(info.duration)
          const vodUrl = transcodeUrl(current.url, {
            startSeconds: startTime,
            audioIndex: audioStreamIndexRef.current,
            mode,
            subtitleIndices: subtitleStreamIndicesRef.current,
            vstart: info?.startTime,
          })
          if (IS_IOS) {
            iosStrategyRef.current = 'hls-gen'
            const capturedCurrent = current
            startHlsSession(current.url, {
              mode,
              audioIndex: audioStreamIndexRef.current,
              startSeconds: startTime,
            }).then((hlsUrl) => {
              if (usePlayerStore.getState().current !== capturedCurrent || !videoRef.current) return
              if (!hlsUrl) { setError(`iOS: HLS generation failed: ${getLastHlsError() || 'unknown'}`); setIsBuffering(false); return }
              videoRef.current.src = hlsUrl
              videoRef.current.play().catch(() => {})
            })
          } else {
            video.src = vodUrl
          }
        } else {
          isTranscodedRef.current = false
          videoStartTimeRef.current = 0
          playbackOffsetRef.current = 0
          transcodedDurationRef.current = null
          video.src = current.url
          if (startTime > 0) {
            video.addEventListener('loadedmetadata', () => { video.currentTime = startTime }, { once: true })
          }
        }
      } else {
        isTranscodedRef.current = false
        playbackOffsetRef.current = 0
        transcodedDurationRef.current = null
        // Potential HLS stream — try HLS.js, fall back to native on any fatal error
        const HlsLib = (await import('hls.js')).default
        if (HlsLib.isSupported()) {
          const hls = new HlsLib({ startPosition: startTime })
          hlsRef.current = hls as unknown as Hls

          hls.on(HlsLib.Events.ERROR, (_e: unknown, data: { fatal: boolean; details?: string }) => {
            if (!data.fatal) return
            hls.destroy()
            hlsRef.current = null
            video.src = current.url
            if (startTime > 0) {
              video.addEventListener('loadedmetadata', () => { video.currentTime = startTime }, { once: true })
            }
            video.play().catch(() => {})
          })
          hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
            if (hls.audioTracks.length > 0) {
              setAudioTracks(hls.audioTracks.map(t => ({ id: t.id, name: t.name, lang: t.lang ?? '' })))
              setActiveAudioTrack(hls.audioTrack)
            }
            if (hls.subtitleTracks.length > 0) {
              setSubtitleTracks(hls.subtitleTracks.map(t => ({ id: t.id, name: t.name, lang: t.lang ?? '' })))
              setActiveSubtitle(hls.subtitleTrack)
            }
          })
          hls.on(HlsLib.Events.AUDIO_TRACKS_UPDATED, () => {
            setAudioTracks(hls.audioTracks.map(t => ({ id: t.id, name: t.name, lang: t.lang ?? '' })))
            setActiveAudioTrack(hls.audioTrack)
          })
          hls.on(HlsLib.Events.AUDIO_TRACK_SWITCHED, () => {
            setActiveAudioTrack(hls.audioTrack)
          })
          hls.on(HlsLib.Events.SUBTITLE_TRACKS_UPDATED, () => {
            setSubtitleTracks(hls.subtitleTracks.map(t => ({ id: t.id, name: t.name, lang: t.lang ?? '' })))
          })
          hls.on(HlsLib.Events.SUBTITLE_TRACK_SWITCH, () => {
            setActiveSubtitle(hls.subtitleTrack)
          })

          hls.loadSource(current.url)
          hls.attachMedia(video)
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = current.url
          video.currentTime = startTime
        } else {
          setError('HLS not supported in this browser')
        }
      }

      if (!msePlaying) video.play().catch(() => {})
    }

    load()
  }, [current, activeProfileId, destroyHls, detachSubtitleTrack])

  // Progress saving; for live channels save once on start (just records lastWatched — no resume point)
  useEffect(() => {
    if (!current || current.type === 'live') {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current)
      if (current?.type === 'live') {
        const profileId = useProfileStore.getState().activeProfileId
        if (profileId) saveProgress(profileId, current.id, 0, 0).then((entry) => pushProgress(entry))
      }
      return
    }
    saveTimerRef.current = setInterval(() => {
      const video = videoRef.current
      if (video && video.currentTime > 0) {
        const profileId = useProfileStore.getState().activeProfileId
        if (!profileId) return
        const realTime = playbackOffsetRef.current + video.currentTime
        saveProgress(profileId, current.id, realTime, video.duration || 0)
          .then((entry) => pushProgress(entry))
      }
    }, SAVE_INTERVAL_MS)
    return () => {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current)
    }
  }, [current])

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => {
      const offset = playbackOffsetRef.current
      setCurrentTime(offset + video.currentTime)
      if (video.buffered.length > 0) {
        setBuffered(offset + video.buffered.end(video.buffered.length - 1))
      }
    }
    const onDurationChange = () => {
      if (transcodedDurationRef.current != null) return
      const d = video.duration
      setDuration(Number.isFinite(d) ? d : 0)
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onVolumeChange = () => {
      setVolume(video.volume)
      setMuted(video.muted)
    }
    const onEnded = () => {
      if (!current || current.type === 'live') return
      const localDur = Number.isFinite(video.duration) ? video.duration : 0
      const realDur = transcodedDurationRef.current ?? (playbackOffsetRef.current + localDur)
      const profileId = useProfileStore.getState().activeProfileId
      if (realDur > 0 && profileId) {
        saveProgress(profileId, current.id, realDur, realDur)
          .then((entry) => pushProgress(entry))
      }
      // Only start countdown when genuinely near the end — guards against
      // spurious 'ended' events browsers fire when video.src is replaced mid-seek.
      const isNearEnd = localDur > 0 && video.currentTime >= localDur * 0.85
      const next = nextEpisodeRef.current
      if (next && isNearEnd && autoplayRef.current) {
        setNextEpCountdown(10)
        countdownIntervalRef.current = setInterval(() => {
          setNextEpCountdown((n) => {
            if (n === null || n <= 1) {
              clearInterval(countdownIntervalRef.current!)
              countdownIntervalRef.current = null
              if (n === 1) usePlayerStore.getState().play(next)
              return null
            }
            return n - 1
          })
        }, 1000)
      }
    }

    const syncNativeAudioTracks = () => {
      if (hlsRef.current) return
      const at = (video as VideoWithAudioTracks).audioTracks
      if (!at || at.length <= 1) return
      const tracks: Track[] = []
      let activeIdx = 0
      for (let i = 0; i < at.length; i++) {
        const t = at[i]
        tracks.push({ id: i, name: t.label || t.language || `Track ${i + 1}`, lang: t.language })
        if (t.enabled) activeIdx = i
      }
      setAudioTracks(tracks)
      setActiveAudioTrack(activeIdx)
    }

    const onNativeSubtitleChange = () => {
      if (hlsRef.current && hlsRef.current.subtitleTracks.length > 0) return
      // Skip when we're driving subtitles from probe + proxy: the <track>
      // element we attach for VTT would otherwise overwrite the probed list.
      if (current && isProxyVideo(current)) return
      const subs = Array.from(video.textTracks).filter(t => t.kind === 'subtitles' || t.kind === 'captions')
      if (subs.length > 0) {
        setSubtitleTracks(subs.map((t, i) => ({ id: i, name: t.label || t.language || `Track ${i + 1}`, lang: t.language })))
      }
    }

    // video.audioTracks is a live object — read it fresh in each handler above.
    // Capture reference once here only for addEventListener/removeEventListener symmetry.
    const nativeAudioTracks = (video as VideoWithAudioTracks).audioTracks

    const onWaiting  = () => setIsBuffering(true)
    const onCanPlay  = () => setIsBuffering(false)
    const onPlaying  = () => setIsBuffering(false)
    const onVideoError = () => {
      const err = video.error
      const code = err?.code ?? 0
      const msg = err?.message ?? ''
      const strategy = iosStrategyRef.current
      logDiagnostic('video-error', {
        code, msg, strategy, isIos: IS_IOS,
        src: video.src.slice(0, 60),
        readyState: video.readyState,
        networkState: video.networkState,
        paused: video.paused,
      })
      // HLS-gen code 4 with non-zero start: provider stream died at seek position.
      // Retry from start=0 so at least the beginning plays.
      if (strategy === 'hls-gen' && code === 4 && !iosHlsRetriedRef.current && playbackOffsetRef.current > 0 && current) {
        iosHlsRetriedRef.current = true
        playbackOffsetRef.current = 0
        setIsBuffering(false)
        setError('Stream failed at saved position — retrying from start…')
        const capturedCurrent = current
        startHlsSession(current.url, {
          mode: proxyModeRef.current ?? 'copy',
          audioIndex: audioStreamIndexRef.current,
          startSeconds: 0,
        }).then((hlsUrl) => {
          if (usePlayerStore.getState().current !== capturedCurrent || !videoRef.current) return
          if (!hlsUrl) { setError(`iOS: Stream failed at saved position. Try again later. (${getLastHlsError() || 'network error'})`); return }
          setError(null)
          setIsBuffering(true)
          videoRef.current.src = hlsUrl
          videoRef.current.play().catch(() => {})
        })
        return
      }
      // HLS path failed (provider 404, wrong URL, etc.) — retry with MSE fMP4
      if (strategy === 'hls' && iosFallbackUrlRef.current) {
        const fallbackUrl = iosFallbackUrlRef.current
        iosStrategyRef.current = 'mse'
        iosFallbackUrlRef.current = null
        logDiagnostic('live-hls-failed-trying-mse', { code })
        const mseLive = startMsePlayback(video, fallbackUrl)
        if (!mseLive) {
          setError(`Live TV: HLS unavailable, MSE not supported (code ${code}) ${getMseDiag()}`)
          setIsBuffering(false)
        }
        return
      }
      const mseLog = mseDiagLogRef.current.length ? ` [${mseDiagLogRef.current.join('→')}]` : ''
      setError(`Playback error (code ${code}, strategy: ${strategy ?? 'direct'}) ${getMseDiag()}${mseLog}`)
      setIsBuffering(false)
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('loadedmetadata', syncNativeAudioTracks)
    video.addEventListener('loadeddata', syncNativeAudioTracks)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('ended', onEnded)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('error', onVideoError)
    nativeAudioTracks?.addEventListener('addtrack', syncNativeAudioTracks)
    nativeAudioTracks?.addEventListener('change', syncNativeAudioTracks)
    video.textTracks.addEventListener('addtrack', onNativeSubtitleChange)
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('loadedmetadata', syncNativeAudioTracks)
      video.removeEventListener('loadeddata', syncNativeAudioTracks)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('volumechange', onVolumeChange)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error', onVideoError)
      nativeAudioTracks?.removeEventListener('addtrack', syncNativeAudioTracks)
      nativeAudioTracks?.removeEventListener('change', syncNativeAudioTracks)
      video.textTracks.removeEventListener('addtrack', onNativeSubtitleChange)
    }
  }, [current])

  // Keyboard shortcuts
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      const video = videoRef.current
      if (!video) return
      switch (e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault()
          video.paused ? video.play() : video.pause()
          break
        case 'ArrowLeft': {
          e.preventDefault()
          const real = playbackOffsetRef.current + video.currentTime
          seekTo(real - 10)
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          const real = playbackOffsetRef.current + video.currentTime
          const maxDur = transcodedDurationRef.current ?? video.duration
          const target = real + 10
          seekTo(Number.isFinite(maxDur) ? Math.min(maxDur, target) : target)
          break
        }
        case 'ArrowUp':
          e.preventDefault()
          video.volume = Math.min(1, video.volume + 0.1)
          break
        case 'ArrowDown':
          e.preventDefault()
          video.volume = Math.max(0, video.volume - 0.1)
          break
        case 'KeyM':
          video.muted = !video.muted
          break
        case 'KeyF':
          if (!document.fullscreenElement) {
            videoRef.current?.parentElement?.requestFullscreen()
          } else {
            document.exitFullscreen()
          }
          break
        case 'Escape':
          if (!document.fullscreenElement) handleClose()
          break
      }
      resetControlsTimer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, handleClose, resetControlsTimer, seekTo])

  // Close player on browser back/forward
  useEffect(() => {
    if (!current) return
    const onPop = () => close()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [current, close])

  // Cleanup on unmount / close
  useEffect(() => {
    if (!current) {
      destroyHls()
      detachSubtitleTrack()
      if (subtitleNoticeTimerRef.current) {
        clearTimeout(subtitleNoticeTimerRef.current)
        subtitleNoticeTimerRef.current = null
      }
      setSubtitleNotice(null)
      if (videoRef.current) {
        videoRef.current.src = ''
      }
    }
  }, [current, destroyHls, detachSubtitleTrack])

  const selectAudioTrack = useCallback((id: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = id
      return
    }
    const video = videoRef.current
    if (current && video && isProxyVideo(current)) {
      // MKV via proxy: switch by reloading the transcode stream with a different
      // -map. ffmpeg can't hot-swap audio mid-stream, so this is a restart at
      // the current position. Stash the active subtitle so we can re-attach it
      // after the new src starts loading.
      const realTime = playbackOffsetRef.current + video.currentTime
      const fullDur = transcodedDurationRef.current
        ?? (Number.isFinite(video.duration) ? video.duration : null)
      const previousSub = activeSubtitleRef.current
      const previousSubInfo = previousSub !== -1
        ? subtitleTracks.find(t => t.id === previousSub) ?? null
        : null
      detachSubtitleTrack()

      audioStreamIndexRef.current = id
      isTranscodedRef.current = true
      playbackOffsetRef.current = realTime
      transcodedDurationRef.current = fullDur
      if (fullDur) setDuration(fullDur)
      setCurrentTime(realTime)
      setBuffered(realTime)
      setActiveAudioTrack(id)
      if (IS_IOS) {
        const capturedCurrent = current
        const capturedSubInfo = previousSubInfo
        startHlsSession(current.url, {
          mode: proxyModeRef.current ?? 'copy',
          audioIndex: id,
          startSeconds: realTime,
        }).then((hlsUrl) => {
          if (usePlayerStore.getState().current !== capturedCurrent || !videoRef.current) return
          if (!hlsUrl) { setError(`iOS: Audio switch failed: ${getLastHlsError() || 'unknown'}`); setIsBuffering(false); return }
          videoRef.current.src = hlsUrl
          videoRef.current.play().catch(() => {})
          if (capturedSubInfo) attachSubtitleTrack(capturedSubInfo.id, capturedSubInfo.name, capturedSubInfo.lang)
        })
        return
      }
      const audioUrl = transcodeUrl(current.url, {
        startSeconds: realTime,
        audioIndex: id,
        mode: proxyModeRef.current ?? undefined,
        subtitleIndices: subtitleStreamIndicesRef.current,
        vstart: videoStartTimeRef.current || undefined,
      })
      video.src = audioUrl
      video.play().catch(() => {})
      if (previousSubInfo) {
        attachSubtitleTrack(previousSubInfo.id, previousSubInfo.name, previousSubInfo.lang)
      }
      return
    }
    const v = video as VideoWithAudioTracks | null
    if (v?.audioTracks) {
      for (let i = 0; i < v.audioTracks.length; i++) {
        v.audioTracks[i].enabled = (i === id)
      }
      setActiveAudioTrack(id)
    }
  }, [current, subtitleTracks, detachSubtitleTrack, attachSubtitleTrack])

  const selectSubtitle = useCallback((id: number) => {
    const hls = hlsRef.current
    const video = videoRef.current
    if (id === -1) {
      if (hls) hls.subtitleTrack = -1
      if (video) Array.from(video.textTracks).forEach(t => { t.mode = 'hidden' })
      detachSubtitleTrack()
      activeSubtitleRef.current = -1
      setActiveSubtitle(-1)
      return
    }
    if (hls && hls.subtitleTracks.length > id) {
      hls.subtitleTrack = id
      activeSubtitleRef.current = id
      return
    }
    if (current && video && isProxyVideo(current)) {
      const info = subtitleTracks.find(t => t.id === id)
      if (!info) return
      activeSubtitleRef.current = id
      setActiveSubtitle(id)
      attachSubtitleTrack(id, info.name, info.lang)
      return
    }
    if (video) {
      const subs = Array.from(video.textTracks).filter(t => t.kind === 'subtitles' || t.kind === 'captions')
      subs.forEach((t, i) => { t.mode = i === id ? 'showing' : 'hidden' })
      activeSubtitleRef.current = id
      setActiveSubtitle(id)
    }
  }, [current, subtitleTracks, attachSubtitleTrack, detachSubtitleTrack])

  // Auto-select preferred subtitle language when tracks first become available
  useEffect(() => {
    if (!preferredSubtitleLang || !subtitleTracks.length || activeSubtitleRef.current !== -1) return
    const match = subtitleTracks.find(t => t.lang?.toLowerCase().startsWith(preferredSubtitleLang.toLowerCase()))
    if (match) selectSubtitle(match.id)
  }, [subtitleTracks, preferredSubtitleLang, selectSubtitle])

  // Auto-select preferred audio language once when tracks first become available for a new item
  useEffect(() => {
    if (!preferredAudioLang || !audioTracks.length || autoAudioSelectedRef.current) return
    autoAudioSelectedRef.current = true
    const match = audioTracks.find(t => t.lang?.toLowerCase().startsWith(preferredAudioLang.toLowerCase()))
    if (match && match.id !== activeAudioTrack) selectAudioTrack(match.id)
  }, [audioTracks, preferredAudioLang, activeAudioTrack, selectAudioTrack])

  if (!current) return null

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    v.paused ? v.play() : v.pause()
  }

  const changeVolume = (val: number) => {
    const v = videoRef.current
    if (!v) return
    v.volume = val
    v.muted = false
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
  }

  const toggleFullscreen = () => {
    const container = videoRef.current?.parentElement
    if (!container) return
    if (!document.fullscreenElement) {
      container.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  const pipAvailable = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (document as Document & { pictureInPictureEnabled: boolean }).pictureInPictureEnabled

  const miniTitle = current.type === 'series'
    ? `S${String(current.season).padStart(2, '0')}E${String(current.episode).padStart(2, '0')} · ${current.showName ?? current.name}`
    : current.movieTitle ?? current.name

  return (
    <div className={`fixed z-50 transition-all duration-300 ${
      minimized
        ? 'bottom-20 md:bottom-4 right-4 w-72 rounded-2xl overflow-hidden bg-black shadow-cinema ring-1 ring-white/10'
        : 'inset-0 bg-black flex flex-col animate-fade-in'
    }`}>
      <div
        className={`relative ${minimized ? 'aspect-video' : 'flex-1'} group cursor-pointer`}
        onMouseMove={minimized ? undefined : resetControlsTimer}
        onTouchEnd={handleTouchEnd}
        onClick={minimized ? () => setMinimized(false) : togglePlay}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain"
          playsInline
          disableRemotePlayback
        />

        {!minimized && error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-surface-50 rounded-xl p-6 max-w-sm text-center">
              <p className="text-red-400 font-medium mb-2">Playback Error</p>
              <p className="text-neutral-400 text-sm select-text cursor-text">{error}</p>
              <button
                onClick={(e) => { e.stopPropagation(); handleClose() }}
                className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {!minimized && !error && isBuffering && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
            <div className="w-12 h-12 rounded-full border-2 border-white/15 border-t-white animate-spin" />
            <p className="text-white/60 text-sm font-medium tracking-wide">Buffering…</p>
          </div>
        )}

        {!minimized && subtitleNotice && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 max-w-md z-10 pointer-events-none">
            <div className="bg-black/80 backdrop-blur-sm border border-red-500/30 text-red-200 text-sm rounded-lg px-4 py-2 shadow-lg">
              {subtitleNotice}
            </div>
          </div>
        )}

        {/* Custom subtitle overlay — absolute-timestamp cues, no re-fetch on seek */}
        {!minimized && activeCue && (
          <div className="absolute bottom-20 left-0 right-0 flex justify-center pointer-events-none z-10 px-8">
            <div className="bg-black/75 text-white text-base font-medium px-3 py-1.5 rounded text-center max-w-2xl whitespace-pre-wrap leading-snug">
              {activeCue.text.replace(/<[^>]+>/g, '').trim()}
            </div>
          </div>
        )}

        {!minimized && seekFeedback && (
          <div
            key={seekFeedback.key}
            className={`absolute top-1/2 -translate-y-1/2 pointer-events-none z-10 flex flex-col items-center gap-1 animate-fade-in ${
              seekFeedback.side === 'left' ? 'left-10' : 'right-10'
            }`}
          >
            <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <span className="text-white font-semibold text-sm tabular-nums">
                {seekFeedback.side === 'left' ? '−10s' : '+10s'}
              </span>
            </div>
          </div>
        )}

        {!minimized && (
          <PlayerControls
            channel={current}
            visible={showControls}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            buffered={buffered}
            volume={volume}
            muted={muted}
            audioTracks={audioTracks}
            activeAudioTrack={activeAudioTrack}
            subtitleTracks={subtitleTracks}
            activeSubtitle={activeSubtitle}
            loadingSubtitle={loadingSubtitle}
            playbackSpeed={playbackSpeed}
            pipAvailable={pipAvailable}
            onTogglePlay={togglePlay}
            onSeek={seekTo}
            onVolumeChange={changeVolume}
            onToggleMute={toggleMute}
            onSelectAudioTrack={selectAudioTrack}
            onSelectSubtitle={selectSubtitle}
            subtitleDelay={subtitleDelay}
            onSubtitleDelayChange={handleSubtitleDelayChange}
            onSpeedChange={handleSpeedChange}
            onToggleFullscreen={toggleFullscreen}
            onPiP={handlePiP}
            onMinimize={() => setMinimized(true)}
            onClose={handleClose}
          />
        )}

        {/* Next episode countdown */}
        {!minimized && nextEpCountdown !== null && nextEpisode && (
          <div
            className="absolute bottom-24 right-6 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-black/85 backdrop-blur-sm rounded-xl p-4 ring-1 ring-white/15 max-w-xs text-right">
              <p className="text-white/50 text-xs mb-1">Next episode in {nextEpCountdown}s</p>
              <p className="text-white text-sm font-medium leading-snug">
                S{String(nextEpisode.season).padStart(2, '0')}E{String(nextEpisode.episode).padStart(2, '0')}
                {nextEpisode.episodeTitle ? ` · ${nextEpisode.episodeTitle}` : ''}
              </p>
              {/* Countdown progress bar */}
              <div className="mt-2 h-0.5 rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-accent-500 transition-[width] duration-1000"
                  style={{ width: `${((10 - nextEpCountdown) / 10) * 100}%` }}
                />
              </div>
              <div className="flex gap-2 mt-3 justify-end">
                <button
                  onClick={clearCountdown}
                  className="text-xs text-white/60 hover:text-white px-2 py-1 rounded hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { clearCountdown(); play(nextEpisode) }}
                  className="text-xs text-white bg-accent-600 hover:bg-accent-500 px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  Play now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mini-player overlay controls */}
        {minimized && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 hover:opacity-100 transition-opacity">
            <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-2 pb-2 pt-4">
              <button
                onClick={(e) => { e.stopPropagation(); togglePlay() }}
                className="text-white/90 hover:text-white p-1 transition-colors shrink-0"
              >
                {isPlaying ? <Pause size={14} fill="white" className="text-white" /> : <Play size={14} fill="white" className="text-white" />}
              </button>
              <p className="text-white text-xs flex-1 truncate min-w-0">{miniTitle}</p>
              <button
                onClick={(e) => { e.stopPropagation(); handleClose() }}
                className="text-white/60 hover:text-white p-1 transition-colors shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

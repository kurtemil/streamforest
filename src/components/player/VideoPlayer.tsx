import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import type Hls from 'hls.js'
import { Play, Pause, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { usePlaylistStore } from '@/stores/playlistStore'
import { saveProgress, getProgress, clearProgress, getTmdbMeta } from '@/services/db'
import { posterUrl } from '@/services/tmdb'
import { pushProgress, deleteRemoteProgress } from '@/services/sync'
import { useProfileStore } from '@/stores/profileStore'
import { usePlaybackPrefsStore } from '@/stores/playbackPrefsStore'
import {
  isTranscodeProxyConfigured, transcodeUrl, liveStreamUrl, probeMedia, pickProxyMode,
  subtitleVttUrl, audioStreamLabel, subtitleStreamLabel, getKeyframeTime, logDiagnostic,
  startHlsSession, getLastHlsError,
} from '@/lib/transcode'
import type { ProxyMode } from '@/lib/transcode'
import {
  trace, traceError, safePlay, mediaSnapshot,
  tracePlaybackStart, tracePlaybackEnd,
} from '@/lib/diagnostics'
import { resolveSaveDuration } from '@/lib/progress'
import { openInVlc } from '@/lib/vlc'
import { normalizeShowKey } from '@/lib/utils'
import { parseVttBlock } from '@/lib/vtt'
import { PlayerControls } from './PlayerControls'

const SAVE_INTERVAL_MS = 5000
const VIDEO_EXT = /\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i

// Playback on iOS goes through server-generated HLS: WebKit plays native HLS
// perfectly, while an fMP4 stream set as video.src needs range-request support
// the proxy cannot offer over a live ffmpeg pipe.
const IS_IOS = typeof navigator !== 'undefined' && (
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
)

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
  // One memory per show, not per episode — the choice that matters is "this
  // series, English subtitles, shifted 1.5 s", and it holds all season.
  const titleKey = current
    ? (current.type === 'series' ? normalizeShowKey(current.showName ?? current.name) : current.id)
    : ''
  const titlePrefs = usePlaybackPrefsStore(
    (s) => s.byTitle[`${activeProfileId ?? ''}:${titleKey}`],
  ) ?? {}
  const setTitlePrefs = usePlaybackPrefsStore((s) => s.setTitlePrefs)
  const autoplayNextEpisode = rawPlaybackPrefs?.autoplayNextEpisode ?? true
  const preferredSubtitleLang = rawPlaybackPrefs?.preferredSubtitleLang ?? ''
  const preferredAudioLang = rawPlaybackPrefs?.preferredAudioLang ?? ''
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Baseline seconds baked into the source URL (for transcode-proxy resume).
  // Real playback time = playbackOffsetRef.current + video.currentTime.
  const playbackOffsetRef = useRef(0)
  // Last position confirmed by a timeupdate event — used by the error handler
  // instead of video.currentTime which Chrome resets to 0 before firing the error.
  const lastKnownRealPosRef = useRef(0)
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
  // Set when the autoplay policy refused a play() that arrived after an await.
  // The stream is fine; it just needs a gesture, so we offer one.
  const [needsGesture, setNeedsGesture] = useState(false)
  // Playlist URL of the current server-side HLS session, kept so the player can
  // keep the session warm while paused (see the heartbeat effect).
  const hlsPlaylistUrlRef = useRef<string | null>(null)
  // Diagnostics: first frame is only interesting once per playback attempt, and a
  // stall is only interesting as a duration — so both need a little state.
  const sawFirstFrameRef = useRef(false)
  const stallStartedRef = useRef<number | null>(null)

  const attemptPlay = useCallback((video: HTMLVideoElement, phase: string) => {
    safePlay(video, phase).then((outcome) => {
      setNeedsGesture(outcome === 'blocked')
      if (outcome === 'blocked') setIsBuffering(false)
    })
  }, [])

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
  }, [])

  // Tracks the iOS playback strategy for the current item so the error handler
  // can fall back from HLS → MSE when the HLS proxy fails (e.g. provider 404).
  const iosStrategyRef = useRef<'hls' | 'hls-gen' | 'mse' | null>(null)
  const iosHlsRetriedRef = useRef(false)
  const reconnectCountRef = useRef(0)

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
    iosHlsRetriedRef.current = false
    sawFirstFrameRef.current = false
    stallStartedRef.current = null
    setNeedsGesture(false)
    hlsPlaylistUrlRef.current = null
    if (current) {
      tracePlaybackStart({
        type: current.type,
        id: current.id,
        isIos: IS_IOS,
        // Everything traced from here until `close` carries this attempt's id, so
        // a failed playback can be read end to end instead of guessed at.
        show: current.type === 'series' ? current.showName ?? current.name : undefined,
      })
    }
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
    setSubtitleDelay(prev => {
      const next = parseFloat(Math.max(-10, Math.min(10, prev + delta)).toFixed(1))
      setTitlePrefs(activeProfileId, titleKey, { subtitleDelay: next })
      return next
    })
  }, [setTitlePrefs, activeProfileId, titleKey])

  useEffect(() => {
    if (!seekFeedback) return
    const t = setTimeout(() => setSeekFeedback(null), 700)
    return () => clearTimeout(t)
  }, [seekFeedback])


  const handleSpeedChange = useCallback((s: number) => {
    playbackSpeedRef.current = s
    setPlaybackSpeed(s)
    if (videoRef.current) videoRef.current.playbackRate = s
  }, [])

  const handlePiP = useCallback(async () => {
    const video = videoRef.current as (HTMLVideoElement & {
      webkitSetPresentationMode?: (mode: 'picture-in-picture' | 'inline') => void
      webkitPresentationMode?: string
    }) | null
    if (!video) return
    // WebKit predates the standard API and still only speaks presentation modes.
    if (typeof video.webkitSetPresentationMode === 'function') {
      const inPiP = video.webkitPresentationMode === 'picture-in-picture'
      video.webkitSetPresentationMode(inPiP ? 'inline' : 'picture-in-picture')
      return
    }
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => {})
    } else {
      await video.requestPictureInPicture().catch(() => {})
    }
  }, [])

  const handleClose = useCallback(() => {
    const video = videoRef.current
    if (video) {
      tracePlaybackEnd({
        reason: 'user-close',
        realPosition: Number((playbackOffsetRef.current + video.currentTime).toFixed(1)),
        ...mediaSnapshot(video),
      })
    }
    if (current && current.type !== 'live' && video && video.currentTime > 0) {
      const profileId = useProfileStore.getState().activeProfileId
      if (profileId) {
        const realTime = playbackOffsetRef.current + video.currentTime
        const dur = resolveSaveDuration(transcodedDurationRef.current, video.duration)
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
    if (!url) return
    logDiagnostic('subtitle-attach', {
      streamIndex,
      startSeconds: startSeconds ?? playbackOffsetRef.current,
      videoCurrentTime: videoRef.current?.currentTime ?? -1,
      playbackOffset: playbackOffsetRef.current,
      isIos: IS_IOS,
      url: url.slice(0, 150),
    })
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
            logDiagnostic('subtitle-first-cues', {
              streamIndex,
              firstCueStart: batch[0]?.start,
              firstCueEnd: batch[0]?.end,
              cueCount: batch.length,
              playbackOffset: playbackOffsetRef.current,
              videoCurrentTime: videoRef.current?.currentTime ?? -1,
              isIos: IS_IOS,
            })
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
    const from = playbackOffsetRef.current + video.currentTime
    if (!isTranscodedRef.current) {
      trace('seek', { method: 'native-direct', from: Number(from.toFixed(1)), to: Number(clamped.toFixed(1)) })
      video.currentTime = clamped
      return
    }
    // Transcoded stream: local time = real − baked-in offset.
    // If within the buffered window, a native seek works; otherwise rebuild
    // the source URL at the new start so ffmpeg restarts from there.
    const offset = playbackOffsetRef.current
    const localTime = clamped - offset
    const covers = (ranges: TimeRanges) => {
      for (let i = 0; i < ranges.length; i++) {
        if (localTime >= ranges.start(i) && localTime <= ranges.end(i)) return true
      }
      return false
    }
    // `seekable` is the payoff from declaring the playlist EVENT: WebKit reports
    // the whole written playlist as seekable, not just what is buffered, so most
    // seeks are now a property assignment instead of a new ffmpeg process and a
    // wait of up to twenty seconds. `buffered` still covers the desktop path,
    // where the source is one long fMP4 response.
    if (localTime >= 0 && (covers(video.buffered) || covers(video.seekable))) {
      trace('seek', {
        method: covers(video.buffered) ? 'native-buffered' : 'native-seekable',
        from: Number(from.toFixed(1)),
        to: Number(clamped.toFixed(1)),
      })
      video.currentTime = localTime
      return
    }
    // Falling through here means a full server round trip — a new ffmpeg process
    // and a wait. Counting how often this happens is what sizes the A4 payoff.
    trace('seek', {
      method: 'session-restart',
      from: Number(from.toFixed(1)),
      to: Number(clamped.toFixed(1)),
      ...mediaSnapshot(video),
    })
    playbackOffsetRef.current = clamped
    reconnectCountRef.current = 0
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
      const savedOffset = playbackOffsetRef.current
      startHlsSession(current.url, {
        mode: proxyModeRef.current ?? 'copy',
        audioIndex: audioStreamIndexRef.current,
        startSeconds: clamped,
      }).then((hlsUrl) => {
        if (usePlayerStore.getState().current !== capturedCurrent || !videoRef.current) return
        if (!hlsUrl) {
          // Restore position so currentTime stays consistent with what's still playing
          playbackOffsetRef.current = savedOffset
          flashSubtitleNotice(`Seek failed: ${getLastHlsError() || 'try again'}`)
          return
        }
        hlsPlaylistUrlRef.current = hlsUrl
        videoRef.current.src = hlsUrl
        attemptPlay(videoRef.current, 'seek-ios')
      })
    } else {
      video.src = seekUrl
      attemptPlay(video, 'seek-desktop')
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
  }, [current, attachSubtitleTrack, flashSubtitleNotice])

  // Touch gestures on the video surface.
  //
  // A single tap toggles the controls — the behaviour every video app on a phone
  // has, and the only way to reach them here at all: the auto-hide timer was
  // driven exclusively by mousemove, so on a touch device the overlay was pinned
  // over the film for its whole runtime. Play/pause lives on the button in the
  // middle of that overlay, where a thumb can find it deliberately.
  //
  // A double tap on either half seeks. It waits out the double-tap window before
  // acting on the single tap, so one gesture never fires both.
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const DOUBLE_TAP_MS = 280

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (minimized) return
    const touch = e.changedTouches[0]
    if (!touch) return
    // Stop the synthetic click that would otherwise follow and toggle playback.
    e.preventDefault()

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const side: 'left' | 'right' = touch.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
    const now = Date.now()
    const last = lastTapRef.current

    if (last?.side === side && now - last.time < DOUBLE_TAP_MS) {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current)
      singleTapTimerRef.current = null
      lastTapRef.current = null
      const v = videoRef.current
      if (v && current?.type !== 'live') {
        // Through seekTo, not video.currentTime: only seekTo knows about the
        // offset baked into a transcoded source and how to rebuild the session
        // when the target lies outside what the server has generated.
        const real = playbackOffsetRef.current + v.currentTime
        const maxDur = transcodedDurationRef.current ?? v.duration
        const target = side === 'left' ? real - 10 : real + 10
        seekTo(Number.isFinite(maxDur) ? Math.min(maxDur, Math.max(0, target)) : Math.max(0, target))
        setSeekFeedback({ side, key: now })
      }
      return
    }

    lastTapRef.current = { time: now, side }
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current)
    singleTapTimerRef.current = setTimeout(() => {
      singleTapTimerRef.current = null
      setShowControls((visible) => {
        if (visible) {
          if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
          controlsTimerRef.current = null
          return false
        }
        resetControlsTimer()
        return true
      })
    }, DOUBLE_TAP_MS)
  }, [minimized, current, seekTo, resetControlsTimer])

  // Load source when current changes
  useEffect(() => {
      if (!current || !videoRef.current) return
    const video = videoRef.current
    setError(null)
    setDuration(0)
    setCurrentTime(0)
    setBuffered(0)
    reconnectCountRef.current = 0
    lastKnownRealPosRef.current = 0
    destroyHls()

    setAudioTracks([])
    setActiveAudioTrack(-1)
    setSubtitleTracks([])
    setActiveSubtitle(-1)
    activeSubtitleRef.current = -1
    audioStreamIndexRef.current = null
    proxyModeRef.current = null
    detachSubtitleTrack()

    const load = async () => {
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
            hlsPlaylistUrlRef.current = hlsUrl
            videoRef.current.src = hlsUrl
            attemptPlay(videoRef.current, 'live-ios')
          })
          return
        }
        const streamSrc = liveStreamUrl(current.url, 'copy')
        if (streamSrc) {
          video.src = streamSrc
          attemptPlay(video, 'live-desktop')
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
            let hlsUrl = await startHlsSession(current.url, {
              mode,
              audioIndex: audioStreamIndexRef.current,
              startSeconds: startTime,
              videoCodec: info?.videoCodec ?? null,
            })
            if (usePlayerStore.getState().current !== capturedCurrent || !videoRef.current) return
            // Provider stream may be truncated short of the saved position — retry from 0.
            if (!hlsUrl && startTime > 0 && !iosHlsRetriedRef.current) {
              iosHlsRetriedRef.current = true
              playbackOffsetRef.current = 0
              setError('Saved position unavailable — loading from start…')
              hlsUrl = await startHlsSession(current.url, {
                mode,
                audioIndex: audioStreamIndexRef.current,
                startSeconds: 0,
              })
              if (usePlayerStore.getState().current !== capturedCurrent || !videoRef.current) return
              if (hlsUrl) setError(null)
            }
            if (!hlsUrl) { setError(`iOS: HLS generation failed: ${getLastHlsError() || 'unknown'}`); setIsBuffering(false); return }
            hlsPlaylistUrlRef.current = hlsUrl
            videoRef.current.src = hlsUrl
            attemptPlay(videoRef.current, 'vod-ios')
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
            attemptPlay(video, 'hlsjs-fallback')
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

      attemptPlay(video, 'load-tail')
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
        // The film's length, not the stream's. For any source the proxy started
        // at an offset, video.duration is only what remains — and saving that
        // against a whole-film position made completed=true five seconds into a
        // resumed film, which dropped it straight out of Continue Watching.
        const dur = resolveSaveDuration(transcodedDurationRef.current, video.duration)
        saveProgress(profileId, current.id, realTime, dur)
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
      const realTime = offset + video.currentTime
      lastKnownRealPosRef.current = realTime
      setCurrentTime(realTime)
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

    const onWaiting  = () => {
      setIsBuffering(true)
      if (stallStartedRef.current === null) {
        stallStartedRef.current = Date.now()
        trace('stall-start', mediaSnapshot(video))
      }
    }
    const onCanPlay  = () => setIsBuffering(false)
    const onPlaying  = () => {
      setIsBuffering(false)
      reconnectCountRef.current = 0
      if (stallStartedRef.current !== null) {
        trace('stall-end', { ms: Date.now() - stallStartedRef.current })
        stallStartedRef.current = null
      }
      // The one measurement that settles A2. If WebKit is treating a growing VOD
      // playlist as live, it starts at the live edge rather than zero and reports
      // a seekable window that does not begin at zero — both visible right here.
      if (!sawFirstFrameRef.current) {
        sawFirstFrameRef.current = true
        trace('first-frame', {
          strategy: iosStrategyRef.current ?? 'direct',
          offset: playbackOffsetRef.current,
          ...mediaSnapshot(video),
        })
      }
    }
    const onVideoError = () => {
      const err = video.error
      const code = err?.code ?? 0
      const msg = err?.message ?? ''
      const strategy = iosStrategyRef.current
      traceError('video-error', {
        code, msg, strategy, isIos: IS_IOS,
        // Time since the stream last made progress: an A1 session reaped after a
        // long pause looks like a code-4 error with a large gap behind it, while
        // a genuinely broken stream fails with no gap at all.
        sinceLastProgress: stallStartedRef.current ? Date.now() - stallStartedRef.current : null,
        reconnects: reconnectCountRef.current,
        ...mediaSnapshot(video),
      })
      // HLS-gen code 4: provider stream failed (truncated file, stale session, etc.).
      // Retry from start=0 — server discards any dead session and spawns fresh ffmpeg.
      if (strategy === 'hls-gen' && code === 4 && !iosHlsRetriedRef.current && current) {
        iosHlsRetriedRef.current = true
        playbackOffsetRef.current = 0
        setIsBuffering(false)
        setError('Stream error — retrying from start…')
        const capturedCurrent = current
        startHlsSession(current.url, {
          mode: proxyModeRef.current ?? 'copy',
          audioIndex: audioStreamIndexRef.current,
          startSeconds: 0,
        }).then((hlsUrl) => {
          if (usePlayerStore.getState().current !== capturedCurrent || !videoRef.current) return
          if (!hlsUrl) { setError(`iOS: Stream failed. Try again later. (${getLastHlsError() || 'network error'})`); return }
          setError(null)
          setIsBuffering(true)
          hlsPlaylistUrlRef.current = hlsUrl
          videoRef.current.src = hlsUrl
          attemptPlay(videoRef.current, 'ios-error-retry')
        })
        return
      }
      // Network/decode error on a desktop proxy stream — auto-reconnect from real position
      // instead of just showing an error. Covers both transcoded VOD and live TV (fMP4 via proxy).
      if (!IS_IOS && (code === 2 || code === 3) && current && (isTranscodedRef.current || current.type === 'live')) {
        const maxRetries = current.type === 'live' ? 20 : 3
        if (reconnectCountRef.current < maxRetries) {
          reconnectCountRef.current++
          // Use lastKnownRealPosRef rather than video.currentTime: Chrome resets
          // currentTime to 0 before firing the error event, which would make us
          // reconnect from the beginning of the episode.
          const realPos = isTranscodedRef.current ? lastKnownRealPosRef.current : 0
          const backoff = Math.min(1000 * reconnectCountRef.current, 5000)
          const retryLabel = current.type === 'live' ? String(reconnectCountRef.current) : `${reconnectCountRef.current}/${maxRetries}`
          const expectedReconnectCount = reconnectCountRef.current
          setError(`Connection lost — reconnecting (${retryLabel})…`)
          setIsBuffering(true)
          const capturedCurrent = current
          setTimeout(() => {
            if (usePlayerStore.getState().current !== capturedCurrent || !videoRef.current) return
            // A manual seek (or new load) resets reconnectCountRef to 0 — bail out so
            // we don't overwrite the position the user explicitly chose.
            if (reconnectCountRef.current !== expectedReconnectCount) return
            setError(null)
            if (isTranscodedRef.current) {
              playbackOffsetRef.current = realPos
              videoRef.current.src = transcodeUrl(capturedCurrent.url, {
                startSeconds: realPos,
                audioIndex: audioStreamIndexRef.current,
                mode: proxyModeRef.current ?? undefined,
                subtitleIndices: subtitleStreamIndicesRef.current,
                vstart: videoStartTimeRef.current || undefined,
              })
              // Copy mode: ffmpeg snaps to the nearest keyframe, so correct
              // playbackOffset to that keyframe (same as seekTo does) to keep
              // subtitle timestamps aligned with the resumed video position.
              if (proxyModeRef.current === 'copy') {
                const reconnectTarget = realPos
                getKeyframeTime(capturedCurrent.url, Math.floor(realPos))
                  .then(keyframe => {
                    if (usePlayerStore.getState().current !== capturedCurrent) return
                    playbackOffsetRef.current = keyframe
                    if (activeSubtitleRef.current >= 0) {
                      const track = subtitleTracksRef.current.find(t => t.id === activeSubtitleRef.current)
                      if (track) attachSubtitleTrack(track.id, track.name, track.lang, reconnectTarget)
                    }
                  })
                  .catch(() => {
                    if (activeSubtitleRef.current >= 0) {
                      const track = subtitleTracksRef.current.find(t => t.id === activeSubtitleRef.current)
                      if (track) attachSubtitleTrack(track.id, track.name, track.lang, realPos)
                    }
                  })
              }
            } else {
              const liveUrl = liveStreamUrl(capturedCurrent.url, 'copy')
              if (!liveUrl) { setError('Live stream reconnect failed'); return }
              videoRef.current.src = liveUrl
            }
            attemptPlay(videoRef.current, 'reconnect')
          }, backoff)
          return
        }
      }
      // The diagnostic detail went to the client log above. What belongs on screen
      // is what happened and what to do about it — the previous message put a
      // codec-support matrix in front of whoever was trying to watch something.
      setError(
        code === 2 ? 'Lost connection to the stream.'
        : code === 3 ? "This title can't be decoded on this device."
        : code === 4 ? "The provider didn't return a playable stream."
        : 'Playback stopped unexpectedly.',
      )
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

  // Native subtitle track, iOS only.
  //
  // The DOM overlay below is the better renderer — absolute timestamps, an
  // adjustable delay, nothing to re-fetch on a seek — but it lives in the page,
  // and iOS fullscreen hands the video to the system, which draws only the
  // element's own text tracks. So the overlay simply disappeared at the moment
  // people actually want subtitles. Now that fullscreen works on iPhone at all
  // (B2), the same cues are mirrored into a real TextTrack.
  //
  // Cue times are absolute file positions; the element's clock starts at whatever
  // offset the stream was opened at, so each cue is rebased — and the delay is
  // folded in here rather than re-fetched.
  useEffect(() => {
    const video = videoRef.current
    if (!IS_IOS || !video || parsedSubtitles.length === 0) return

    const track = video.addTextTrack('subtitles', 'StreamForest', 'und')
    track.mode = 'showing'
    const offset = playbackOffsetRef.current
    let added = 0
    for (const cue of parsedSubtitles) {
      const start = cue.start - offset - subtitleDelay
      const end = cue.end - offset - subtitleDelay
      if (end <= 0) continue
      try {
        track.addCue(new VTTCue(Math.max(0, start), end, cue.text.replace(/<[^>]+>/g, '').trim()))
        added++
      } catch { /* a malformed cue must not take the rest of the track with it */ }
    }
    trace('subtitle-native-track', { cues: added, offset, delay: subtitleDelay })

    return () => {
      track.mode = 'disabled'
      // There is no removeTextTrack; disabling and dropping the cues is the
      // documented way to retire one.
      while (track.cues && track.cues.length > 0) {
        try { track.removeCue(track.cues[0]) } catch { break }
      }
    }
  }, [parsedSubtitles, subtitleDelay, current?.id])

  // Lock screen, control centre, headphone buttons and the car.
  //
  // Without this the OS has no idea what is playing: no title, no artwork, and
  // no way to pause or skip without unlocking the phone and finding the tab.
  // The metadata comes from the same TMDB cache the library already fills, so
  // this costs a lookup, not a fetch.
  useEffect(() => {
    if (!current || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    let cancelled = false

    const title = current.type === 'series'
      ? `S${String(current.season).padStart(2, '0')}E${String(current.episode).padStart(2, '0')}${current.episodeTitle ? ` · ${current.episodeTitle}` : ''}`
      : current.movieTitle ?? current.name
    const album = current.type === 'series' ? (current.showName ?? current.name) : 'StreamForest'

    const tmdbKey = current.type === 'series' && current.showName
      ? normalizeShowKey(current.showName)
      : current.id

    getTmdbMeta(tmdbKey).then((meta) => {
      if (cancelled) return
      const poster = meta && !meta.notFound ? posterUrl(meta.posterPath ?? null, 500) : null
      ms.metadata = new MediaMetadata({
        title,
        artist: album,
        album: 'StreamForest',
        artwork: poster ? [{ src: poster, sizes: '500x750', type: 'image/jpeg' }] : [],
      })
    }).catch(() => { /* artwork is a nicety; the title still lands */ })

    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => { const v = videoRef.current; if (v) attemptPlay(v, 'mediasession') }],
      ['pause', () => videoRef.current?.pause()],
      ['seekbackward', () => seekTo(lastKnownRealPosRef.current - 10)],
      ['seekforward', () => seekTo(lastKnownRealPosRef.current + 10)],
      ['seekto', (details) => {
        if (typeof details.seekTime === 'number') seekTo(playbackOffsetRef.current + details.seekTime)
      }],
      ['nexttrack', () => { const n = nextEpisodeRef.current; if (n) usePlayerStore.getState().play(n) }],
    ]
    for (const [action, handler] of handlers) {
      // Not every action exists in every browser; an unsupported one throws.
      try { ms.setActionHandler(action, handler) } catch { /* unsupported action */ }
    }

    return () => {
      cancelled = true
      for (const [action] of handlers) {
        try { ms.setActionHandler(action, null) } catch { /* unsupported action */ }
      }
      ms.metadata = null
    }
  }, [current, seekTo, attemptPlay])

  // Mirror transport state, so the lock screen shows the right button.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = current ? (isPlaying ? 'playing' : 'paused') : 'none'
  }, [isPlaying, current])

  // Keep the server-side HLS session alive while the player is open.
  //
  // The server reaps sessions that go untouched, and it can only see requests.
  // A paused player fetches nothing, so without this a long pause looked exactly
  // like a closed app: the session was destroyed and every segment 404'd on
  // resume. One HEAD every 30 s is enough to say "still watching".
  useEffect(() => {
    if (!current) return
    const ping = setInterval(() => {
      const url = hlsPlaylistUrlRef.current
      if (!url) return
      fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => {
        // A failed ping is not actionable on its own — the error handler owns
        // recovery. Losing the session is what we are preventing, not detecting.
      })
    }, 30_000)
    return () => clearInterval(ping)
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
          video.paused ? attemptPlay(video, 'keyboard') : video.pause()
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
      // Covers the paths that bypass handleClose — browser back, profile switch,
      // an unmount. tracePlaybackEnd is a no-op if handleClose already ran.
      tracePlaybackEnd({ reason: 'teardown' })
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
      const chosenLang = audioTracks.find(t => t.id === id)?.lang
      if (chosenLang) setTitlePrefs(activeProfileId, titleKey, { audioLang: chosenLang })
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
          hlsPlaylistUrlRef.current = hlsUrl
          videoRef.current.src = hlsUrl
          attemptPlay(videoRef.current, 'audio-switch-ios')
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
      attemptPlay(video, 'audio-switch-desktop')
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
  }, [current, subtitleTracks, audioTracks, detachSubtitleTrack, attachSubtitleTrack, setTitlePrefs, activeProfileId, titleKey])

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
      if (info.lang) setTitlePrefs(activeProfileId, titleKey, { subtitleLang: info.lang })
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

  // Pick the subtitle track: what was chosen for this title last time first, the
  // profile's language preference second.
  useEffect(() => {
    if (!subtitleTracks.length || activeSubtitleRef.current !== -1) return
    const remembered = titlePrefs.subtitleLang
    const wanted = remembered || preferredSubtitleLang
    if (!wanted) return
    const match = subtitleTracks.find(t => t.lang?.toLowerCase().startsWith(wanted.toLowerCase()))
    if (match) selectSubtitle(match.id)
  }, [subtitleTracks, preferredSubtitleLang, titlePrefs.subtitleLang, selectSubtitle])

  // Same for audio, once per item.
  useEffect(() => {
    if (!audioTracks.length || autoAudioSelectedRef.current) return
    const wanted = titlePrefs.audioLang || preferredAudioLang
    if (!wanted) return
    autoAudioSelectedRef.current = true
    const match = audioTracks.find(t => t.lang?.toLowerCase().startsWith(wanted.toLowerCase()))
    if (match && match.id !== activeAudioTrack) selectAudioTrack(match.id)
  }, [audioTracks, preferredAudioLang, titlePrefs.audioLang, activeAudioTrack, selectAudioTrack])

  // Restore the saved subtitle offset for this title. A file that is out of sync
  // is normally out of sync by the same amount for a whole season, so having to
  // dial it in again every episode was the single most repetitive thing here.
  useEffect(() => {
    if (typeof titlePrefs.subtitleDelay === 'number') setSubtitleDelay(titlePrefs.subtitleDelay)
  }, [titleKey, titlePrefs.subtitleDelay])

  if (!current) return null

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      // Error state + proxy stream: naive v.play() re-fetches from byte 0, resetting position.
      // Rebuild the URL from real position instead so playback resumes where it stopped.
      if (v.error && (isTranscodedRef.current || current?.type === 'live') && current) {
        seekTo(playbackOffsetRef.current + v.currentTime)
      } else {
        attemptPlay(v, 'tap')
      }
    } else if (!isBuffering) {
      v.pause()
    }
    // if buffering (!paused but waiting): do nothing — video resumes automatically when buffer fills
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
    const video = videoRef.current
    const container = video?.parentElement
    if (!video || !container) return

    // iPhone implements no Fullscreen API on ordinary elements — only
    // webkitEnterFullscreen on the video itself. The button was therefore dead on
    // the device where fullscreen matters most.
    const iosVideo = video as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void
      webkitSupportsFullscreen?: boolean
    }
    if (typeof container.requestFullscreen !== 'function') {
      if (iosVideo.webkitSupportsFullscreen && iosVideo.webkitEnterFullscreen) {
        trace('fullscreen', { api: 'webkitEnterFullscreen' })
        iosVideo.webkitEnterFullscreen()
      } else {
        trace('fullscreen', { api: 'unavailable' })
      }
      return
    }
    if (!document.fullscreenElement) {
      trace('fullscreen', { api: 'requestFullscreen' })
      container.requestFullscreen().catch(() => {
        if (iosVideo.webkitEnterFullscreen) iosVideo.webkitEnterFullscreen()
      })
    } else {
      document.exitFullscreen()
    }
  }

  // WebKit exposes picture-in-picture through presentation modes rather than the
  // standard property, so the button was hidden on exactly the devices that
  // support it best.
  const pipAvailable = typeof document !== 'undefined' && (
    ('pictureInPictureEnabled' in document && (document as Document & { pictureInPictureEnabled: boolean }).pictureInPictureEnabled) ||
    typeof (HTMLVideoElement.prototype as HTMLVideoElement & {
      webkitSetPresentationMode?: unknown
    }).webkitSetPresentationMode === 'function'
  )

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
          /* No disableRemotePlayback: that attribute was required by the
             ManagedMediaSource experiment, and while it sat here AirPlay was off
             for the whole app — on the one device family most likely to have an
             Apple TV in the room. */
        />

        {!minimized && error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-surface-50 rounded-xl p-6 max-w-sm text-center">
              <p className="text-red-400 font-medium mb-2">Playback Error</p>
              <p className="text-neutral-400 text-sm select-text cursor-text">{error}</p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); openInVlc(current) }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
                  title="Open in VLC"
                >
                  <span className="w-2 h-2 rounded-sm bg-[#ff8800]" />
                  Open in VLC
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setError(null) }}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* The autoplay policy refused a play() that arrived after the wait for
            the server session. Nothing is broken — the gesture had simply expired
            — so offer a new one instead of a spinner that never resolves. */}
        {!minimized && needsGesture && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                const v = videoRef.current
                if (v) attemptPlay(v, 'gesture-recovery')
              }}
              aria-label="Play"
              className="flex flex-col items-center gap-3 group"
            >
              <span className="w-20 h-20 rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/30 flex items-center justify-center transition-transform group-active:scale-95">
                <Play size={34} fill="white" className="text-white ml-1" />
              </span>
              <span className="text-white/80 text-sm font-medium">Tap to play</span>
            </button>
          </div>
        )}

        {!minimized && !error && !needsGesture && isBuffering && (
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

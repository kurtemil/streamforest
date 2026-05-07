import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import type Hls from 'hls.js'
import { Play, Pause, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { usePlaylistStore } from '@/stores/playlistStore'
import { saveProgress, getProgress, clearProgress } from '@/services/db'
import { pushProgress, deleteRemoteProgress } from '@/services/sync'
import { useProfileStore } from '@/stores/profileStore'
import {
  isTranscodeProxyConfigured, transcodeUrl, liveStreamUrl, probeMedia, pickProxyMode,
  subtitleVttUrl, audioStreamLabel, subtitleStreamLabel,
} from '@/lib/transcode'
import type { ProxyMode } from '@/lib/transcode'
import { normalizeShowKey } from '@/lib/utils'
import { PlayerControls } from './PlayerControls'

const SAVE_INTERVAL_MS = 5000
const VIDEO_EXT = /\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i

interface Track { id: number; name: string; lang: string }

function isProxyVideo(channel: { type: string; url: string } | null): boolean {
  if (!channel || !isTranscodeProxyConfigured()) return false
  return channel.type === 'movie' || channel.type === 'series' || VIDEO_EXT.test(channel.url)
}

function parseVttTimestamp(s: string): number {
  const m = s.match(/^(?:(\d+):)?(\d+):(\d+)\.(\d+)$/)
  if (!m) return NaN
  const h = m[1] ? Number(m[1]) : 0
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000
}

function parseVttBlock(block: string): VTTCue | null {
  const lines = block.split('\n').filter(l => l.length > 0)
  if (lines.length === 0) return null
  if (lines[0].startsWith('WEBVTT')) return null
  if (/^(NOTE|STYLE|REGION)\b/.test(lines[0])) return null
  const tsIdx = lines.findIndex(l => l.includes('-->'))
  if (tsIdx < 0) return null
  const [rawStart, rawEnd] = lines[tsIdx].split('-->').map(s => s.trim().split(/\s+/)[0] ?? '')
  const start = parseVttTimestamp(rawStart)
  const end = parseVttTimestamp(rawEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const content = lines.slice(tsIdx + 1).join('\n').trim()
  if (!content) return null
  try {
    return new VTTCue(start, end, content)
  } catch {
    return null
  }
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
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
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
  // Tracks the active VTT subtitle so we can re-attach after a src reload
  // (audio swap rebuilds video.src, which clears any addTextTrack-created list).
  const activeSubtitleRef = useRef(-1)
  const subtitleTextTrackRef = useRef<TextTrack | null>(null)
  const subtitleAbortRef = useRef<AbortController | null>(null)
  // Stall threshold: only abort the subtitle stream if NO bytes arrive for this
  // long. As long as ffmpeg keeps producing cues we stay connected, however
  // long the full extraction takes — first cues display within seconds anyway.
  const SUBTITLE_STALL_MS = 30_000
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

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
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

  // Re-apply playback speed after every source load (browser resets to 1× on src change)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onMeta = () => { video.playbackRate = playbackSpeedRef.current }
    video.addEventListener('loadedmetadata', onMeta)
    return () => video.removeEventListener('loadedmetadata', onMeta)
  }, [])

  // Reset minimized + clear countdown on new item
  useEffect(() => {
    setMinimized(false)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    countdownIntervalRef.current = null
    setNextEpCountdown(null)
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
    navigate(-1)
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
    const track = subtitleTextTrackRef.current
    if (track) {
      track.mode = 'disabled'
      while (track.cues && track.cues.length > 0) {
        track.removeCue(track.cues[0])
      }
    }
    subtitleTextTrackRef.current = null
  }, [])

  const attachSubtitleTrack = useCallback(async (streamIndex: number, label: string, lang: string) => {
    const video = videoRef.current
    if (!video || !current) return
    const url = subtitleVttUrl(current.url, streamIndex)
    if (!url) return
    detachSubtitleTrack()
    const ctrl = new AbortController()
    subtitleAbortRef.current = ctrl
    setLoadingSubtitle(streamIndex)

    // Stall detection: abort only if NO bytes for STALL_MS. While ffmpeg is
    // producing cues we keep streaming, however long it takes.
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
      let track: TextTrack | null = null
      let cueCount = 0

      const ensureTrack = () => {
        if (track) return track
        track = video.addTextTrack('subtitles', label, lang || '')
        track.mode = 'showing'
        subtitleTextTrackRef.current = track
        // First cue arrived — drop the spinner; cues will keep streaming in.
        setLoadingSubtitle((cur) => (cur === streamIndex ? null : cur))
        return track
      }

      const flush = (final: boolean) => {
        let idx
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const cue = parseVttBlock(block)
          if (cue) { ensureTrack().addCue(cue); cueCount++ }
        }
        if (final && buffer.length > 0) {
          const cue = parseVttBlock(buffer)
          if (cue) { ensureTrack().addCue(cue); cueCount++ }
          buffer = ''
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          buffer += decoder.decode()
          flush(true)
          break
        }
        lastByteAt = Date.now()
        // Normalize CRLF/CR → LF as bytes arrive (each chunk is independent
        // for normalization since CR alone collapses to LF too).
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
        flush(false)
      }

      if (cueCount === 0) {
        throw new Error('Subtitle stream had no readable cues')
      }
    } catch (err) {
      const aborted = (err as { name?: string }).name === 'AbortError'
      // Silent only on user-initiated abort (track switch / unmount). A stall
      // is also an AbortError but we mark it via `stalled` to surface it.
      if (aborted && !stalled) return
      const msg = stalled
        ? 'Subtitle extraction stalled — no data from proxy in 30 s'
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
    video.src = transcodeUrl(current.url, {
      startSeconds: clamped,
      audioIndex: audioStreamIndexRef.current,
      mode: proxyModeRef.current ?? undefined,
    })
    video.play().catch(() => {})
  }, [current])

  // Load source when current changes
  useEffect(() => {
      if (!current || !videoRef.current) return
    const video = videoRef.current
    setError(null)
    setDuration(0)
    setCurrentTime(0)
    setBuffered(0)
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
        const proxied = isTranscodeProxyConfigured() ? liveStreamUrl(current.url) : null
        if (proxied) {
          isTranscodedRef.current = false
          playbackOffsetRef.current = 0
          transcodedDurationRef.current = null
          video.src = proxied
          video.play().catch(() => {})
          return
        }
        setError('Live TV requires the transcode proxy. Set VITE_TRANSCODE_PROXY_URL.')
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
        const info = isProxyVideo(current)
          ? await probeMedia(current.url)
          : null

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
          playbackOffsetRef.current = startTime
          transcodedDurationRef.current = info?.duration ?? null
          if (info?.duration) setDuration(info.duration)
          video.src = transcodeUrl(current.url, {
            startSeconds: startTime,
            audioIndex: audioStreamIndexRef.current,
            mode,
          })
        } else {
          isTranscodedRef.current = false
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

      video.play().catch(() => {})
    }

    load()
  }, [current, activeProfileId, destroyHls, detachSubtitleTrack])

  // Progress saving (skipped for live — there's no resume point on a live feed)
  useEffect(() => {
    if (!current || current.type === 'live') {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current)
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
      // Start next-episode countdown for series
      const next = nextEpisodeRef.current
      if (next) {
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

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('loadedmetadata', syncNativeAudioTracks)
    video.addEventListener('loadeddata', syncNativeAudioTracks)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('ended', onEnded)
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
      video.src = transcodeUrl(current.url, {
        startSeconds: realTime,
        audioIndex: id,
        mode: proxyModeRef.current ?? undefined,
      })
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
        ? 'bottom-4 right-4 w-72 rounded-2xl overflow-hidden bg-black shadow-cinema ring-1 ring-white/10'
        : 'inset-0 bg-black flex flex-col animate-fade-in'
    }`}>
      <div
        className={`relative ${minimized ? 'aspect-video' : 'flex-1'} group cursor-pointer`}
        onMouseMove={minimized ? undefined : resetControlsTimer}
        onClick={minimized ? () => setMinimized(false) : togglePlay}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain"
          playsInline
        />

        {!minimized && error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-surface-50 rounded-xl p-6 max-w-sm text-center">
              <p className="text-red-400 font-medium mb-2">Playback Error</p>
              <p className="text-neutral-400 text-sm">{error}</p>
              <button
                onClick={(e) => { e.stopPropagation(); handleClose() }}
                className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {!minimized && subtitleNotice && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 max-w-md z-10 pointer-events-none">
            <div className="bg-black/80 backdrop-blur-sm border border-red-500/30 text-red-200 text-sm rounded-lg px-4 py-2 shadow-lg">
              {subtitleNotice}
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
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-2 pb-2 pt-4">
              <button
                onClick={togglePlay}
                className="text-white/90 hover:text-white p-1 transition-colors shrink-0"
              >
                {isPlaying ? <Pause size={14} fill="white" className="text-white" /> : <Play size={14} fill="white" className="text-white" />}
              </button>
              <p className="text-white text-xs flex-1 truncate min-w-0">{miniTitle}</p>
              <button onClick={handleClose} className="text-white/60 hover:text-white p-1 transition-colors shrink-0">
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

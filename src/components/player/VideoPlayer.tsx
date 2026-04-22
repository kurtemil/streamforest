import { useEffect, useRef, useCallback, useState } from 'react'
import type Hls from 'hls.js'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { saveProgress, getProgress } from '@/services/db'
import { PlayerControls } from './PlayerControls'

const SAVE_INTERVAL_MS = 5000
const VIDEO_EXT = /\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i

interface Track { id: number; name: string; lang: string }

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
  const { current, close } = usePlayerStore()
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
  }, [])

  const resetControlsTimer = useCallback(() => {
    setShowControls(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3500)
  }, [])

  const handleClose = useCallback(() => {
    navigate(-1)
    close()
  }, [navigate, close])

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

    const load = async () => {
      const saved = await getProgress(current.id)
      const startTime = saved && !saved.completed ? saved.position : 0

      if (VIDEO_EXT.test(current.url)) {
        // Direct video file — native path, fast and reliable
        video.src = current.url
        if (startTime > 0) {
          video.addEventListener('loadedmetadata', () => { video.currentTime = startTime }, { once: true })
        }
      } else {
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
  }, [current, destroyHls])

  // Progress saving
  useEffect(() => {
    if (!current) {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current)
      return
    }
    saveTimerRef.current = setInterval(() => {
      const video = videoRef.current
      if (video && video.currentTime > 0) {
        saveProgress(current.id, video.currentTime, video.duration || 0)
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
      setCurrentTime(video.currentTime)
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1))
      }
    }
    const onDurationChange = () => setDuration(video.duration || 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onVolumeChange = () => {
      setVolume(video.volume)
      setMuted(video.muted)
    }
    const onEnded = () => {
      if (current) saveProgress(current.id, video.duration, video.duration)
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
        case 'ArrowLeft':
          e.preventDefault()
          video.currentTime = Math.max(0, video.currentTime - 10)
          break
        case 'ArrowRight':
          e.preventDefault()
          video.currentTime = Math.min(video.duration, video.currentTime + 10)
          break
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
  }, [current, handleClose, resetControlsTimer])

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
      if (videoRef.current) {
        videoRef.current.src = ''
      }
    }
  }, [current, destroyHls])

  const selectAudioTrack = useCallback((id: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = id
      return
    }
    const video = videoRef.current as VideoWithAudioTracks
    if (video?.audioTracks) {
      for (let i = 0; i < video.audioTracks.length; i++) {
        video.audioTracks[i].enabled = (i === id)
      }
      setActiveAudioTrack(id)
    }
  }, [])

  const selectSubtitle = useCallback((id: number) => {
    const hls = hlsRef.current
    const video = videoRef.current
    if (id === -1) {
      if (hls) hls.subtitleTrack = -1
      if (video) Array.from(video.textTracks).forEach(t => { t.mode = 'hidden' })
      setActiveSubtitle(-1)
      return
    }
    if (hls && hls.subtitleTracks.length > id) {
      hls.subtitleTrack = id
    } else if (video) {
      const subs = Array.from(video.textTracks).filter(t => t.kind === 'subtitles' || t.kind === 'captions')
      subs.forEach((t, i) => { t.mode = i === id ? 'showing' : 'hidden' })
      setActiveSubtitle(id)
    }
  }, [])

  if (!current) return null

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    v.paused ? v.play() : v.pause()
  }

  const seek = (time: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = time
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

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col animate-fade-in">
      <div
        className="relative flex-1 group cursor-pointer"
        onMouseMove={resetControlsTimer}
        onClick={togglePlay}
      >
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          playsInline
        />

        {error && (
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
          onTogglePlay={togglePlay}
          onSeek={seek}
          onVolumeChange={changeVolume}
          onToggleMute={toggleMute}
          onSelectAudioTrack={selectAudioTrack}
          onSelectSubtitle={selectSubtitle}
          onToggleFullscreen={toggleFullscreen}
          onClose={handleClose}
        />
      </div>
    </div>
  )
}

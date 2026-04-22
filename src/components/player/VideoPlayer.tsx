import { useEffect, useRef, useCallback, useState } from 'react'
import type Hls from 'hls.js'
import { usePlayerStore } from '@/stores/playerStore'
import { saveProgress, getProgress } from '@/services/db'
import { PlayerControls } from './PlayerControls'

const SAVE_INTERVAL_MS = 5000
const HLS_EXTENSIONS = /\.(m3u8)$/i
const MKV_EXTENSION = /\.(mkv|mp4|avi|mov)$/i

function isHlsUrl(url: string): boolean {
  return HLS_EXTENSIONS.test(url) || (!MKV_EXTENSION.test(url) && !url.includes('/movie/') && !url.includes('/series/'))
}

export function VideoPlayer() {
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

  // Load source when current changes
  useEffect(() => {
    if (!current || !videoRef.current) return
    const video = videoRef.current
    setError(null)
    setDuration(0)
    setCurrentTime(0)
    setBuffered(0)
    destroyHls()

    const load = async () => {
      const saved = await getProgress(current.id)
      const startTime = saved && !saved.completed ? saved.position : 0

      if (isHlsUrl(current.url)) {
        const HlsLib = (await import('hls.js')).default
        if (HlsLib.isSupported()) {
          const hls = new HlsLib({ startPosition: startTime })
          hlsRef.current = hls as unknown as Hls
          hls.loadSource(current.url)
          hls.attachMedia(video)
          hls.on(HlsLib.Events.ERROR, (_e: unknown, data: { fatal: boolean }) => {
            if (data.fatal) setError('Stream error — the channel may be offline')
          })
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = current.url
          video.currentTime = startTime
        } else {
          setError('HLS not supported in this browser')
        }
      } else {
        video.src = current.url
        if (startTime > 0) {
          video.addEventListener('loadedmetadata', () => {
            video.currentTime = startTime
          }, { once: true })
        }
      }

      video.play().catch(() => { /* autoplay blocked */ })
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

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('volumechange', onVolumeChange)
      video.removeEventListener('ended', onEnded)
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
          if (!document.fullscreenElement) close()
          break
      }
      resetControlsTimer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, close, resetControlsTimer])

  // Cleanup on unmount / close
  useEffect(() => {
    if (!current) {
      destroyHls()
      if (videoRef.current) {
        videoRef.current.src = ''
      }
    }
  }, [current, destroyHls])

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
                onClick={(e) => { e.stopPropagation(); close() }}
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
          onTogglePlay={togglePlay}
          onSeek={seek}
          onVolumeChange={changeVolume}
          onToggleMute={toggleMute}
          onToggleFullscreen={toggleFullscreen}
          onClose={close}
        />
      </div>
    </div>
  )
}

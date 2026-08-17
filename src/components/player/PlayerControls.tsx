import { useRef, useState, useEffect } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2, X,
  SkipBack, SkipForward, Languages, Loader2, PictureInPicture2,
} from 'lucide-react'
import type { Channel } from '@/types'
import { formatTime } from '@/lib/time'
import { openInVlc } from '@/lib/vlc'

interface Track { id: number; name: string; lang: string }

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

interface Props {
  channel: Channel
  visible: boolean
  isPlaying: boolean
  currentTime: number
  duration: number
  buffered: number
  volume: number
  muted: boolean
  audioTracks: Track[]
  activeAudioTrack: number
  subtitleTracks: Track[]
  activeSubtitle: number
  loadingSubtitle: number | null
  playbackSpeed: number
  pipAvailable: boolean
  onTogglePlay: () => void
  onSeek: (t: number) => void
  onVolumeChange: (v: number) => void
  onToggleMute: () => void
  onSelectAudioTrack: (id: number) => void
  onSelectSubtitle: (id: number) => void
  subtitleDelay: number
  onSubtitleDelayChange: (delta: number) => void
  onSpeedChange: (s: number) => void
  onToggleFullscreen: () => void
  onPiP: () => void
  onMinimize: () => void
  onClose: () => void
}

export function PlayerControls({
  channel, visible, isPlaying,
  currentTime, duration, buffered,
  volume, muted,
  audioTracks, activeAudioTrack, subtitleTracks, activeSubtitle, loadingSubtitle,
  subtitleDelay, onSubtitleDelayChange,
  playbackSpeed, pipAvailable,
  onTogglePlay, onSeek, onVolumeChange, onToggleMute,
  onSelectAudioTrack, onSelectSubtitle, onSpeedChange,
  onToggleFullscreen, onPiP, onMinimize, onClose,
}: Props) {
  const scrubberRef = useRef<HTMLDivElement>(null)
  const [showTrackMenu, setShowTrackMenu] = useState(false)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverPct, setHoverPct] = useState(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!visible) { setShowTrackMenu(false); setShowSpeedMenu(false) }
  }, [visible])

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0
  const isLive = channel.type === 'live'

  // Pointer events rather than mouse events: one code path covers mouse, pen and
  // finger. The old handlers were onClick/onMouseMove, so on a touch device the
  // scrubber could be tapped but never dragged.
  const getScrubRatio = (clientX: number) => {
    if (!scrubberRef.current || duration === 0) return null
    const rect = scrubberRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    const ratio = getScrubRatio(e.clientX)
    if (ratio === null) return
    // Capture, so a finger that slides off the 4px track keeps scrubbing.
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setHoverTime(ratio * duration)
    setHoverPct(ratio * 100)
    onSeek(ratio * duration)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const ratio = getScrubRatio(e.clientX)
    if (ratio === null) return
    setHoverTime(ratio * duration)
    setHoverPct(ratio * 100)
    if (dragging) onSeek(ratio * duration)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDragging(false)
    if (e.pointerType !== 'mouse') setHoverTime(null)
  }

  const title = channel.type === 'series'
    ? `${channel.showName} · S${String(channel.season).padStart(2, '0')}E${String(channel.episode).padStart(2, '0')}${channel.episodeTitle ? ` · ${channel.episodeTitle}` : ''}`
    : channel.type === 'movie'
    ? `${channel.movieTitle ?? channel.name}${channel.year ? ` (${channel.year})` : ''}`
    : channel.name

  return (
    <div
      className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      {/* Top bar */}
      <div
        className="flex items-start justify-between p-4 pt-5 pt-safe px-safe"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col">
          <p className="text-white font-semibold text-base leading-tight max-w-xl">{title}</p>
          {channel.groupTitle && (
            <p className="text-neutral-400 text-xs mt-0.5">{channel.groupTitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); openInVlc(channel) }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
            title="Open in VLC"
          >
            <span className="w-2 h-2 rounded-sm bg-[#ff8800]" />
            <span className="text-xs font-semibold tracking-wide">VLC</span>
          </button>
          <button
            onClick={onMinimize}
            className="p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors"
            title="Minimize"
          >
            <Minimize2 size={18} />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Bottom controls */}
      <div
        className="flex flex-col gap-3 px-4 pb-5 pt-8 pb-safe px-safe"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrubber */}
        {!isLive && (
          <div className="flex items-center gap-3">
            <span className="text-white/70 text-xs tabular-nums w-11 text-right shrink-0">
              {formatTime(currentTime)}
            </span>
            <div
              ref={scrubberRef}
              className="relative flex-1 h-11 flex items-center group/scrub cursor-pointer touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onMouseLeave={() => { if (!dragging) setHoverTime(null) }}
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(currentTime)}
              tabIndex={0}
            >
              {/* Hover time tooltip */}
              {hoverTime !== null && duration > 0 && (
                <div
                  className="absolute bottom-full mb-2 -translate-x-1/2 bg-black/90 text-white text-xs font-medium px-2 py-1 rounded pointer-events-none whitespace-nowrap"
                  style={{ left: `${hoverPct}%` }}
                >
                  {formatTime(hoverTime)}
                </div>
              )}
              {/* Track */}
              <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/20" />
              {/* Buffered */}
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/30 transition-[width] duration-150"
                style={{ width: `${bufferedPct}%` }}
              />
              {/* Progress */}
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 group-hover/scrub:h-1.5 rounded-full bg-accent-500 transition-all duration-100"
                style={{ width: `${pct}%` }}
              />
              {/* Thumb */}
              <div
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-md transition-all ${dragging ? 'w-5 h-5' : 'w-3.5 h-3.5'}`}
                style={{ left: `${pct}%` }}
              />
            </div>
            <span className="text-white/70 text-xs tabular-nums w-11 shrink-0">
              {formatTime(duration)}
            </span>
          </div>
        )}

        {/* Buttons row */}
        <div className="flex items-center justify-between">
          {/* Left cluster */}
          <div className="flex items-center gap-1">
            {!isLive && (
              <button
                onClick={() => onSeek(Math.max(0, currentTime - 10))}
                className="p-2 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
              >
                <SkipBack size={20} />
              </button>
            )}
            <button
              onClick={onTogglePlay}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              {isPlaying ? <Pause size={22} /> : <Play size={22} />}
            </button>
            {!isLive && (
              <button
                onClick={() => onSeek(Math.min(duration, currentTime + 10))}
                className="p-2 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
              >
                <SkipForward size={20} />
              </button>
            )}

            {/* Volume */}
            <div className="flex items-center gap-1 ml-2 group/vol">
              <button
                onClick={onToggleMute}
                className="p-2 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
              >
                {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                min="0" max="1" step="0.02"
                value={muted ? 0 : volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                aria-label="Volume"
                className="w-20 h-1 accent-accent-500 cursor-pointer hidden md:block md:opacity-0 md:group-hover/vol:opacity-100 transition-opacity"
              />
            </div>

            {isLive && (
              <span className="ml-2 flex items-center gap-1.5 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-400">LIVE</span>
              </span>
            )}
          </div>

          {/* Right cluster */}
          <div className="flex items-center gap-1">
            {/* Speed */}
            {!isLive && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(v => !v); setShowTrackMenu(false) }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    showSpeedMenu || playbackSpeed !== 1
                      ? 'text-accent-400 bg-accent-600/20'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {playbackSpeed === 1 ? '1×' : `${playbackSpeed}×`}
                </button>
                {showSpeedMenu && (
                  <div
                    className="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur-sm rounded-xl py-1.5 min-w-[5rem] shadow-2xl shadow-black/60 ring-1 ring-white/10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {SPEEDS.map(s => (
                      <button
                        key={s}
                        onClick={() => { onSpeedChange(s); setShowSpeedMenu(false) }}
                        className={`flex items-center justify-between w-full px-3 py-1.5 text-sm transition-colors ${
                          s === playbackSpeed ? 'text-accent-400' : 'text-white/80 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {s}×
                        {s === playbackSpeed && <span className="w-1.5 h-1.5 rounded-full bg-accent-500 ml-2" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Audio / Subtitle tracks */}
            {(audioTracks.length > 1 || subtitleTracks.length > 0) && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowTrackMenu(v => !v); setShowSpeedMenu(false) }}
                  className={`p-2 rounded-full hover:bg-white/10 transition-colors ${showTrackMenu ? 'text-accent-500' : 'text-white/80 hover:text-white'}`}
                >
                  <Languages size={18} />
                </button>
                {showTrackMenu && (
                  <div
                    className="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur-sm rounded-xl p-3 min-w-44 shadow-2xl shadow-black/60 ring-1 ring-white/10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {audioTracks.length > 1 && (
                      <>
                        <p className="text-white/50 text-xs uppercase tracking-wider mb-2 px-2">Audio</p>
                        {audioTracks.map(t => (
                          <button
                            key={t.id}
                            onClick={() => { onSelectAudioTrack(t.id); setShowTrackMenu(false) }}
                            className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-white/10 text-left text-sm transition-colors ${activeAudioTrack === t.id ? 'text-accent-500' : 'text-white/80'}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeAudioTrack === t.id ? 'bg-accent-500' : 'bg-white/30'}`} />
                            {t.name || t.lang || `Track ${t.id + 1}`}
                          </button>
                        ))}
                      </>
                    )}
                    {subtitleTracks.length > 0 && (
                      <>
                        {audioTracks.length > 1 && <div className="border-t border-white/10 my-2" />}
                        <p className="text-white/50 text-xs uppercase tracking-wider mb-2 px-2">Subtitles</p>
                        <button
                          onClick={() => { onSelectSubtitle(-1); setShowTrackMenu(false) }}
                          className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-white/10 text-left text-sm transition-colors ${activeSubtitle === -1 ? 'text-accent-500' : 'text-white/80'}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeSubtitle === -1 ? 'bg-accent-500' : 'bg-white/30'}`} />
                          Off
                        </button>
                        {subtitleTracks.map(t => {
                          const isLoading = loadingSubtitle === t.id
                          const isActive = activeSubtitle === t.id
                          return (
                            <button
                              key={t.id}
                              onClick={() => { if (!isLoading) onSelectSubtitle(t.id) }}
                              disabled={isLoading}
                              className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-white/10 text-left text-sm transition-colors disabled:opacity-70 ${isActive ? 'text-accent-500' : 'text-white/80'}`}
                            >
                              {isLoading ? (
                                <Loader2 size={12} className="shrink-0 animate-spin text-white/60" />
                              ) : (
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-accent-500' : 'bg-white/30'}`} />
                              )}
                              {t.name || t.lang || `Track ${t.id + 1}`}
                            </button>
                          )
                        })}
                        {activeSubtitle !== -1 && (
                          <>
                            <div className="border-t border-white/10 my-2" />
                            <p className="text-white/50 text-xs uppercase tracking-wider mb-2 px-2">Sync</p>
                            <div className="flex items-center gap-1 px-2">
                              <button
                                onClick={() => onSubtitleDelayChange(-0.5)}
                                className="flex-1 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-white/70 hover:text-white text-xs transition-colors"
                              >
                                −0.5s
                              </button>
                              <span className="w-14 text-center text-xs tabular-nums text-white/60">
                                {subtitleDelay > 0 ? `+${subtitleDelay.toFixed(1)}s` : subtitleDelay === 0 ? '0.0s' : `${subtitleDelay.toFixed(1)}s`}
                              </span>
                              <button
                                onClick={() => onSubtitleDelayChange(0.5)}
                                className="flex-1 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-white/70 hover:text-white text-xs transition-colors"
                              >
                                +0.5s
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* PiP */}
            {pipAvailable && (
              <button
                onClick={onPiP}
                className="p-2 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                title="Picture in Picture"
              >
                <PictureInPicture2 size={18} />
              </button>
            )}

            <button
              onClick={onToggleFullscreen}
              className="p-2 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
            >
              <Maximize2 size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

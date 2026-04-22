import { useRef, useState, useEffect } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Maximize2, X,
  SkipBack, SkipForward, Languages,
} from 'lucide-react'
import type { Channel } from '@/types'
import { formatTime } from '@/lib/time'

interface Track { id: number; name: string; lang: string }

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
  onTogglePlay: () => void
  onSeek: (t: number) => void
  onVolumeChange: (v: number) => void
  onToggleMute: () => void
  onSelectAudioTrack: (id: number) => void
  onSelectSubtitle: (id: number) => void
  onToggleFullscreen: () => void
  onClose: () => void
}

export function PlayerControls({
  channel, visible, isPlaying,
  currentTime, duration, buffered,
  volume, muted,
  audioTracks, activeAudioTrack, subtitleTracks, activeSubtitle,
  onTogglePlay, onSeek, onVolumeChange, onToggleMute,
  onSelectAudioTrack, onSelectSubtitle,
  onToggleFullscreen, onClose,
}: Props) {
  const scrubberRef = useRef<HTMLDivElement>(null)
  const [showTrackMenu, setShowTrackMenu] = useState(false)

  useEffect(() => {
    if (!visible) setShowTrackMenu(false)
  }, [visible])

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0
  const isLive = channel.type === 'live'

  const handleScrubberClick = (e: React.MouseEvent) => {
    if (!scrubberRef.current || duration === 0) return
    e.stopPropagation()
    const rect = scrubberRef.current.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    onSeek(Math.max(0, Math.min(duration, ratio * duration)))
  }

  const handleScrubberDrag = (e: React.MouseEvent) => {
    if (e.buttons !== 1) return
    handleScrubberClick(e)
  }

  const title = channel.type === 'series'
    ? `${channel.showName} · S${String(channel.season).padStart(2, '0')}E${String(channel.episode).padStart(2, '0')}${channel.episodeTitle ? ` · ${channel.episodeTitle}` : ''}`
    : channel.type === 'movie'
    ? `${channel.movieTitle ?? channel.name}${channel.year ? ` (${channel.year})` : ''}`
    : channel.name

  return (
    <div
      className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ pointerEvents: visible ? 'auto' : 'none' }}
    >
      {/* Top bar */}
      <div
        className="flex items-start justify-between p-4 pt-5"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col">
          <p className="text-white font-semibold text-base leading-tight max-w-xl">{title}</p>
          {channel.groupTitle && (
            <p className="text-neutral-400 text-xs mt-0.5">{channel.groupTitle}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Bottom controls */}
      <div
        className="flex flex-col gap-3 px-4 pb-5 pt-8"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrubber (hidden for live) */}
        {!isLive && (
          <div className="flex items-center gap-3">
            <span className="text-white/70 text-xs tabular-nums w-11 text-right shrink-0">
              {formatTime(currentTime)}
            </span>
            <div
              ref={scrubberRef}
              className="relative flex-1 h-5 group/scrub cursor-pointer"
              onClick={handleScrubberClick}
              onMouseMove={handleScrubberDrag}
            >
              {/* Track */}
              <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/20" />
              {/* Buffered */}
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/30 transition-[width] duration-150"
                style={{ width: `${bufferedPct}%` }}
              />
              {/* Progress */}
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-accent-500 transition-[width] duration-150"
                style={{ width: `${pct}%` }}
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md opacity-0 group-hover/scrub:opacity-100 transition-opacity"
                style={{ left: `${pct}%` }}
              />
            </div>
            <span className="text-white/70 text-xs tabular-nums w-11 shrink-0">
              {formatTime(duration)}
            </span>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {/* Play/Pause */}
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
                className="w-20 h-1 accent-accent-500 cursor-pointer opacity-0 group-hover/vol:opacity-100 transition-opacity"
              />
            </div>

            {isLive && (
              <span className="ml-2 flex items-center gap-1.5 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-400">LIVE</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {(audioTracks.length > 1 || subtitleTracks.length > 0) && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowTrackMenu(v => !v) }}
                  className={`p-2 rounded-full hover:bg-white/10 transition-colors ${showTrackMenu ? 'text-accent-500' : 'text-white/80 hover:text-white'}`}
                >
                  <Languages size={18} />
                </button>
                {showTrackMenu && (
                  <div
                    className="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur-sm rounded-xl p-3 min-w-44"
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
                        {subtitleTracks.map(t => (
                          <button
                            key={t.id}
                            onClick={() => { onSelectSubtitle(t.id); setShowTrackMenu(false) }}
                            className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-white/10 text-left text-sm transition-colors ${activeSubtitle === t.id ? 'text-accent-500' : 'text-white/80'}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeSubtitle === t.id ? 'bg-accent-500' : 'bg-white/30'}`} />
                            {t.name || t.lang || `Track ${t.id + 1}`}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
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

import { create } from 'zustand'
import type { Channel } from '@/types'

interface PlayerState {
  current: Channel | null
  playing: boolean
  volume: number
  muted: boolean
  fullscreen: boolean
  showControls: boolean

  play: (channel: Channel) => void
  close: () => void
  setPlaying: (v: boolean) => void
  setVolume: (v: number) => void
  setMuted: (v: boolean) => void
  setFullscreen: (v: boolean) => void
  setShowControls: (v: boolean) => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  current: null,
  playing: false,
  volume: 1,
  muted: false,
  fullscreen: false,
  showControls: true,

  play: (channel) => set({ current: channel, playing: true }),
  close: () => set({ current: null, playing: false }),
  setPlaying: (v) => set({ playing: v }),
  setVolume: (v) => set({ volume: v }),
  setMuted: (v) => set({ muted: v }),
  setFullscreen: (v) => set({ fullscreen: v }),
  setShowControls: (v) => set({ showControls: v }),
}))

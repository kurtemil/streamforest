import { create } from 'zustand'
import type { Channel } from '@/types'
import { toPlaylistHost } from '@/lib/provider'
import { usePlaylistStore } from '@/stores/playlistStore'
import { useBionStore } from '@/stores/bionStore'
import { useProfileStore } from '@/stores/profileStore'

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

  // Every playback starts here, so this is where a stream URL carrying the
  // provider's dead panel domain is pointed at the host the playlist comes from.
  // The stored catalogue may predate the move; the URL is fixed on the way out.
  play: (channel) => {
    // Bion mode: the film goes to the kiosk in the basement instead of playing here.
    // This is the one door every Play goes through, so no card needs to know.
    const bion = useBionStore.getState()
    const profileId = useProfileStore.getState().activeProfileId
    if (bion.mode && profileId) { void bion.playIptv(channel, profileId); return }
    const url = toPlaylistHost(channel.url, usePlaylistStore.getState().m3uUrl)
    set({ current: url === channel.url ? channel : { ...channel, url }, playing: true })
  },
  close: () => set({ current: null, playing: false }),
  setPlaying: (v) => set({ playing: v }),
  setVolume: (v) => set({ volume: v }),
  setMuted: (v) => set({ muted: v }),
  setFullscreen: (v) => set({ fullscreen: v }),
  setShowControls: (v) => set({ showControls: v }),
}))
